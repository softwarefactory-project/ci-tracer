# Copyright 2019 Red Hat
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may
# not use this file except in compliance with the License. You may obtain
# a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
# WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
# License for the specific language governing permissions and limitations
# under the License.

"""The goal of this tool is to start the BPF program and serialize its output"""

from bcc import BPF  # type: ignore
from time import sleep, strftime, monotonic, time
import os
import argparse
import json
import signal
import threading

from collections import defaultdict, namedtuple
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple
from sys import argv, stdout, stderr


def usage():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--output-limit", help="size in MB", default=256)
    parser.add_argument("--interval", help="in msec, zero to disable", type=int, default=1000)
    parser.add_argument("--min-cpu", help="in msec", type=int)
    parser.add_argument("--output")
    parser.add_argument("--debug", action='store_true', default=False)
    return parser.parse_args()


def warn(*msg):
    print("\033[92m%s\033[m" % msg, file=stderr)


# Globals to keep the code simple
start_time = monotonic()
start_time_unix = time()
args = usage()
running = True
output = open(args.output, "w") if args.output else stdout
boot_time = int(open("/proc/stat").read().split('btime')[1].split()[0])
clock = int(os.sysconf('SC_CLK_TCK'))
pid_max = int(open("/proc/sys/kernel/pid_max").read())

# Debug exec/pid/fork accounting
DEBUG = args.debug

# Types
class Perf:
    value: int


@dataclass
class Process:
    pid: int
    ppid: int
    cid: int
    argv: List[str]
    start: int = -1
    rc: Optional[int] = None

    def serialize(self, history: Set[int] = None) -> None:
        if history is None:
            history = set()
        if self.pid in history:
            warn(f"Circular pid/ppid {self} ({history})")
            return
        history.add(self.pid)

        if self.cid not in cgrs_serialized:
            print('{"cgr": %d, "v": %s},' % (self.cid, json.dumps(get_cgname(self.cid).replace('unified/', ''))),
                  file=output)
            cgrs_serialized.add(self.cid)

        if self.ppid in pids and self.ppid not in pids_serialized:
            pids[self.ppid].serialize(history)
            pids_serialized.add(self.ppid)

        print('{"pid": %d, "ppid": %d, "t": %d, "cg": %d, "v": %s},' % (
            self.pid, self.ppid, self.start, self.cid, json.dumps(self.argv)), file=output)


# Cache cgroup name and pid info
cgrs: Dict[int, str] = {}
pids: Dict[int, Process] = {}
# Keep track of what has been serialized
cgrs_serialized: Set[int] = set()
pids_serialized: Set[int] = set()


# Proc collection
class EventType(object):
    INIT = 0
    ARGS = 1
    EXEC = 2
    EXIT = 3
    FORK = 4


def handle_exec_event(event):
    """Process execs perf event"""
    try:

        if event.type == EventType.FORK:
            if event.ppid not in pids:
                # Unknown parent, let's try to scan the child
                try:
                    pid = scan_pid(event.pid)
                except FileNotFoundError:
                    if DEBUG:
                        print(f"NEW-FORK already died pid:{event.pid} ppid:{event.ppid}", file=stderr)
                    return
                if DEBUG:
                    print(f"NEW-FORK {pid}", file=stderr)
            else:
                # Copy the parent process info
                parent = pids[event.ppid]
                pid = Process(event.pid, event.ppid, parent.cid, parent.argv)
                pid.start = int(monotonic() - start_time)
                if DEBUG:
                    print(f"FORK {pid}", file=stderr)
            try:
                # PID got recycled, need to re-serialize
                pids_serialized.remove(event.pid)
            except KeyError:
                pass
            pids[event.pid] = pid

        elif event.type == EventType.INIT:
            if not event.arg:
                # Somehow zuul and ansible manage to execve("", ["zuul-worker"]). Let's skip those for now
                return
            pid = Process(event.pid, event.ppid, event.cgroup, [event.arg.decode('utf-8')])
            pids[event.pid] = pid

        elif event.type == EventType.ARGS:
            pids[event.pid].argv.append(event.arg.decode('utf-8'))

        elif event.type == EventType.EXEC:
            if event.cgroup:
                # exec failed
                del pids[event.pid]
                return
            pid = pids[event.pid]
            pid.start = int(monotonic() - start_time)
            try:
                # If PID got recycled, serialize the new info
                pids_serialized.remove(event.pid)
            except KeyError:
                pass
            if DEBUG:
                print(f"EXEC {pid}", file=stderr)

        elif event.type == EventType.EXIT:
            pid = pids[event.pid]
            pid.rc = event.cgroup
            if DEBUG:
                print(f"EXIT {pid}", file=stderr)

    except KeyError:
        # Sometime pids are unknown when process clone or events are out of order.
        # It's ok, we only care about pid that successfully execve
        # warn(f"Unknown {event.pid} {event.ppid} for {event.type} ({event.arg})")
        pass


def collect_cpu(oncpus: Dict[Perf, Perf]) -> None:
    """Periodically dump the oncpus content"""
    cpu_start = monotonic()
    interval_sec = args.interval / 1000
    while running:
        clock_time = interval_sec - (monotonic() - cpu_start)
        if clock_time > 0:
            sleep(clock_time)
        cpu_start = monotonic()
        buffer: List[Tuple[int, float]] = []
        for k, v in oncpus.items():
            ts: float = v.value  / 1e6
            if args.min_cpu and ts < args.min_cpu:
                continue
            pid: int = k.value
            if pid not in pids:
                # Skip unknown pids
                continue
            buffer.append((pid, ts))
        oncpus.clear()

        if args.json:
            relnow = cpu_start - start_time
            tl = ['{"ts": %.2f},' % relnow]
            for pid, ts in buffer:
                inf = pids[pid]
                if inf.start == -1 or (relnow - inf.start) < .5:
                    # Process started less than a .5 second ago
                    continue
                if pid not in pids_serialized:
                    inf.serialize()
                    pids_serialized.add(pid)
                tl.append('{"cpu": %d, "v": %.3f},' % (pid, ts))
            print("".join(tl), file=output)
        elif buffer:
            print("[%s]" % strftime("%H:%M:%S"), file=output)
            for pid, ts in sorted(buffer, key=lambda kv: kv[1]):
                inf = pids[pid]
                print("%s:\t%s[%d] spent %.3fms" % (
                    get_cgname(inf.cid), inf.argv[0], pid, ts), file=output)


# Load information about existing resources
def scan_cgroups() -> None:
    for w in os.walk("/sys/fs/cgroup"):
        d = w[0]
        cgid = os.stat(d).st_ino
        cgrs[cgid] = d[15:]


def get_cgname(cgid: int) -> str:
    if cgrs.get(cgid) is None:
        print(f"{cgid}: re-scanning cg", file=stderr)
        scan_cgroups()
    cgr = cgrs.get(cgid)
    return cgr if cgr else "unknown"


def scan_pid(pid) -> Process:
    ppid = int(list(filter(lambda x: x.startswith("PPid:"), open(f"/proc/{pid}/status").readlines()))[0].split()[1])
    argv = [os.readlink(f"/proc/{pid}/exe")]
    argv += list(filter(lambda x: x, open(f"/proc/{pid}/cmdline").read().split("\x00")[1:-1]))
    cgroup = open(f"/proc/{pid}/cgroup").readlines()[-1].split('/', 1)[1][:-1]
    if cgroup:
        cgroup_path = os.path.join("/sys/fs/cgroup", cgroup)
        if not os.path.exists(cgroup_path):
            cgroup_path = os.path.join("/sys/fs/cgroup/unified", cgroup)
        cgroup_id = os.stat(cgroup_path).st_ino
    else:
        cgroup_id = 1
    inf = Process(pid, ppid, cgroup_id, argv)
    stat = open(f"/proc/{pid}/stat").read().split(')')[-1].split()
    inf.start = int(int(stat[21 - 2]) / clock + boot_time - start_time_unix)
    return inf


def scan_pids() -> None:
    for pid_str in os.listdir("/proc"):
        try:
            pid = int(pid_str)
        except ValueError:
            continue
        try:
            pid_info = scan_pid(pid)
            if pid_info.cid == 1:
                # Skip process without cgroup
                continue
            pids[pid] = pid_info
        except FileNotFoundError:
            # Process may be gone
            pass


def run() -> None:
    global running

    # Exit gracefully on sigterm
    def sigterm(signum, frame):
        global running
        running = False
    signal.signal(signal.SIGTERM, sigterm)

    # Load the program
    program = open(os.path.join(os.path.dirname(__file__), "agent.c"))
    bpf = BPF(src_file=os.path.join(os.path.dirname(__file__), "agent.c"), cflags=[
        "-DPID_MAX=%d" % pid_max, "-DINTERVAL_NS=%d" % int(1e9 * args.interval)])

    if args.json:
        print('[{"interval": %d},{"start": %d},' % (args.interval, start_time_unix), file=output)

    # Scan initial resources
    scan_pids()
    scan_cgroups()

    #bpf.attach_kretprobe(event=bpf.get_syscall_fnname("clone"), fn_name="syscall__clone")
    bpf.attach_kprobe(event=bpf.get_syscall_fnname("execve"), fn_name="syscall__execve")
    bpf.attach_kretprobe(event=bpf.get_syscall_fnname("execve"), fn_name="do_ret_sys_execve")
    bpf["execs"].open_perf_buffer(lambda c, d, s: handle_exec_event(bpf["execs"].event(d)))

    if args.interval:
        bpf.attach_kprobe(event="finish_task_switch", fn_name="finish_task_switch")
        c = threading.Thread(target=collect_cpu, name="collect-cpu", args=(bpf["oncpus"],))
        c.start()

    # Main loop
    try:
        output_limit = args.output_limit * 1e6
        while running:
            bpf.perf_buffer_poll(timeout=1000)
            if args.output:
                if output.tell() > output_limit:
                    print("Reached output size limit", file=stderr)
                    running = False

    except KeyboardInterrupt:
        running = False
        pass

    finally:
        if args.interval:
            c.join()
        if args.json:
            end = '{"end": %d}]' % (monotonic() - start_time)
        else:
            end = "Done."
        print(end, file=output)


if __name__ == "__main__":
    run()
