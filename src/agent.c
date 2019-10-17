/* Copyright 2019 Red Hat

   Licensed under the Apache License, Version 2.0 (the "License"); you may
   not use this file except in compliance with the License. You may obtain
   a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
   WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
   License for the specific language governing permissions and limitations
   under the License. */

/* The goal of this program is to collect process informations.
*/
#define BPF_LICENSE GPL
#include <linux/sched.h>

// Internal data to record next task start time
BPF_HASH(start_time, u32, u64, PID_MAX);
// Shared data of tgid and oncpu time
BPF_HASH(oncpus, u32, u64, PID_MAX);

/*
RAW_TRACEPOINT_PROBE(sched_switch)
{
  u64 cur_time = bpf_ktime_get_ns();
  struct task_struct *prev = (struct task_struct *)ctx->args[1];
  struct task_struct *next= (struct task_struct *)ctx->args[2];

  u32 pid;
  u32 tgid;
  bpf_probe_read(&pid, sizeof(prev->pid), &prev->pid);
  bpf_probe_read(&tgid, sizeof(prev->tgid), &prev->tgid);

  if (tgid) {
    u64 *prev_time = start_time.lookup(&pid);
    if (prev_time != NULL) {
      // Previous task start time was recorded, compute the time it spent oncpu
      u64 delta = (cur_time - *prev_time);
      if (delta > 0 && delta < INTERVAL_NS) {
        // Per tgid cpu info
        u64 *oncpu = oncpus.lookup(&tgid);
        if (oncpu != NULL) {
          delta += *oncpu;
        }
        // Record time per task group
        oncpus.update(&tgid, &delta);
      }
    }
  }

  // Record the start time of the next
  u32 next_pid;

  bpf_probe_read(&next_pid, sizeof(next->pid), &next->pid);
  cur_time = bpf_ktime_get_ns();
  start_time.update(&next_pid, &cur_time);
  return 0;
}
*/

// Each time the scheduler switch a task this function get called
int finish_task_switch(struct pt_regs *ctx, struct task_struct *prev)
{
  u64 cur_time = bpf_ktime_get_ns();
  u32 pid = prev->pid;
  u32 tgid = prev->tgid;
  if (tgid) {
    u64 *prev_time = start_time.lookup(&pid);
    if (prev_time != NULL) {
      // Previous task start time was recorded, compute the time it spent oncpu
      u64 delta = (cur_time - *prev_time);
      if (delta > 0 && delta < INTERVAL_NS) {
        // Per tgid cpu info
        u64 *oncpu = oncpus.lookup(&tgid);
        if (oncpu != NULL) {
          delta += *oncpu;
        }
        // Record time per task group
        oncpus.update(&tgid, &delta);
      }
    }
  }

  // Record the start time of the next task
  u32 next_pid = bpf_get_current_pid_tgid() & 0xffffffff;
  cur_time = bpf_ktime_get_ns();
  start_time.update(&next_pid, &cur_time);
  return 0;
}


// The exec perf channel
BPF_PERF_OUTPUT(execs);

#define MAXARGS  8
#define ARGSIZE  128

enum execs_perf_type {
                      EVENT_TYPE_INIT,
                      EVENT_TYPE_ARGS,
                      EVENT_TYPE_EXEC,
                      EVENT_TYPE_EXIT,
                      EVENT_TYPE_FORK,
};

struct exec_info_t {
  enum execs_perf_type type;
  u32 pid;
  u32 ppid;
  u32 cgroup;
  char arg[ARGSIZE];
};

static int submit_arg(struct pt_regs *ctx, void *ptr, struct exec_info_t *inf)
{
  const char *argp = NULL;
  bpf_probe_read(&argp, sizeof(argp), ptr);
  if (argp) {
    bpf_probe_read(&inf->arg, sizeof(inf->arg), argp);
    if (inf->arg[0]) {
      execs.perf_submit(ctx, inf, sizeof(struct exec_info_t));
    }
    return 1;
  }
  return 0;
}

int syscall__execve(struct pt_regs *ctx,
                    const char __user *filename,
                    const char __user *const __user *__argv,
                    const char __user *const __user *__envp)
{
  // Send initial info
  struct task_struct *tsk = (struct task_struct *)bpf_get_current_task();
  struct exec_info_t inf = {};
  inf.type = EVENT_TYPE_INIT;
  inf.pid = tsk->tgid;
  inf.ppid = tsk->real_parent->tgid;
  inf.cgroup = bpf_get_current_cgroup_id() & 0xffffffff;
  bpf_probe_read(inf.arg, sizeof(inf.arg), filename);
  execs.perf_submit(ctx, &inf, sizeof(inf));

  // Send argv
  inf.type = EVENT_TYPE_ARGS;
#pragma unroll
  for (int i = 1; i < MAXARGS; i++) {
    if (submit_arg(ctx, (void *)&__argv[i], &inf) == 0)
      break;
  }
  return 0;
}

int do_ret_sys_execve(struct pt_regs *ctx)
{
  struct task_struct *tsk = (struct task_struct *)bpf_get_current_task();
  struct exec_info_t inf = {};
  inf.pid = tsk->tgid;
  inf.ppid = tsk->real_parent->tgid;
  inf.type = EVENT_TYPE_EXEC;
  // EVENT_TYPE_EXEC store the exec success status in the cgroup field
  inf.cgroup = PT_REGS_RC(ctx);
  execs.perf_submit(ctx, &inf, sizeof(inf));
  return 0;
}

/* // tracepoint to collect threads
TRACEPOINT_PROBE(sched, sched_process_exec)
//  int syscall__clone(struct pt_regs *ctx) {
{
  struct task_struct *tsk = (struct task_struct *)bpf_get_current_task();
  struct exec_info_t inf = {};
  inf.type = EVENT_TYPE_INIT;
  inf.pid = tsk->tgid; //bpf_get_current_pid_tgid() >> 32;
  //inf.pid = tsk->pidPT_REGS_RC(ctx);
  inf.ppid = tsk->real_parent->tgid;
  inf.cgroup = bpf_get_current_cgroup_id() & 0xffffffff;
  bpf_get_current_comm(&inf.arg, sizeof(inf.arg));
  execs.perf_submit(args, &inf, sizeof(inf));
  return 0;
}
*/

TRACEPOINT_PROBE(sched, sched_process_fork)
{
  struct exec_info_t inf = {};
  inf.type = EVENT_TYPE_FORK;
  inf.pid = args->child_pid;
  inf.ppid = args->parent_pid;
  inf.cgroup = bpf_get_current_cgroup_id() & 0xffffffff;
  execs.perf_submit(args, &inf, sizeof(inf));
  return 0;
}

TRACEPOINT_PROBE(sched, sched_process_exit)
{
  struct task_struct *tsk = (struct task_struct *)bpf_get_current_task();
  if (tsk->pid != tsk->tgid) {
    // thread died
    return 0;
  }
  struct exec_info_t inf = {};
  inf.pid = tsk->tgid;
  inf.type = EVENT_TYPE_EXIT;
  inf.ppid = tsk->real_parent->tgid;
  // EVENT_TYPE_EXIT store the exit code in the cgroup field
  inf.cgroup = tsk->exit_code >> 8;
  bpf_get_current_comm(&inf.arg, sizeof(inf.arg));
  execs.perf_submit(args, &inf, sizeof(inf));
  return 0;
}
