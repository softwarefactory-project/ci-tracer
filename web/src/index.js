// Copyright 2019 Red Hat, Inc
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may
// not use this file except in compliance with the License. You may obtain
// a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations
// under the License.

import React, { useState } from 'react';
import '@patternfly/react-core/dist/styles/base.css';
import ReactDOM from 'react-dom';
import Axios from 'axios';
import {
  Card, CardBody, CardHeader, CardFooter,
  List, ListItem,
  Nav, NavList, NavItem, NavVariants,
  Page, PageHeader, PageSection, PageSectionVariants,
  Text, TextContent,
} from '@patternfly/react-core';
import { Flex, FlexItem } from '@patternfly/react-core';
import { SortableTable } from "./table.js"
import { Bars, HeatMap, Tree } from "./graph.js"
//import { StackChart } from './chart.js'

import './index.css'

// List of pids, cgroups, ...
const ResourcesContext = React.createContext('resources')

const Pid = props => (
  <div>
    <span>{props.prefix} {props.pid.pid}: {props.pid.name} {props.pid.args}</span>
    <ul>
      {props.pid.children.map((child, idx) => (
        <li key={child.pid}><span><Pid prefix={idx + 1 === props.pid.children.length ? "\\-" : "\\_"}
                                       pid={child} /></span></li>
      ))}
    </ul>
  </div>
)

const Processes = props => (
  <React.Fragment>
    <SortableTable
      columns={[
        {title: "pid", sort: true},
        {title: "ppid", sort: true},
        {title: "cg", sort: true},
        {title: "name", sort: true},
        {title: "cpu_total", sort: true},
        {title: "created", sort: true},
        {title: "args", sort: false, class: "overflow"},
      ]}
      rows={props.pidsCpu}
    />
    <Pid pid={props.root} prefix={""}/>
  </React.Fragment>
)

const Cgroups = props => (
  <React.Fragment>
  <SortableTable
    columns={[
      {title: "id", sort: true},
      {title: "name", sort: true},
      {title: "cpu_total", sort: true},
    ]}
    rows={props.cgroupsCpu}
    />
  </React.Fragment>
)

const CgroupInfo = props => (
  <List style={{textAlign: "left"}}>
    <ListItem>Cgroup: {props.cgroup.name}</ListItem>
    <ListItem>Total: {Math.round(props.cgroup.cpu_total)} ms</ListItem>
    <ListItem>Pid: {props.cgroup.pids.slice(0,5).join(" ")}</ListItem>
  </List>
)

const PidInfo = props => (
  <List style={{textAlign: "left"}}>
    <ListItem>Pid: [{props.pid.id}] {props.pid.name} {props.pid.args}</ListItem>
    {props.pid.cpu_total && (<ListItem>Total: {Math.round(props.pid.cpu_total)} ms</ListItem>)}
    <ListItem>Created: {props.pid.created.toISOString()}</ListItem>
    {props.pids[props.pid.ppid] && (
      <ListItem>Parent: <PidInfo pid={props.pids[props.pid.ppid]} pids={props.pids}/></ListItem>
    )}
  </List>
)


export class CgroupTooltip extends React.PureComponent {
  static contextType = ResourcesContext;
  render() {
    return (
      <Card style={this.props.style}>
        <CardHeader>{this.props.ts.toISOString()}: <b>{this.props.value}</b> ms</CardHeader>
        <CardBody>
          <CgroupInfo cgroup={this.context.cgroups[this.props.id]} />
        </CardBody>
      </Card>)
  }
}


export class PidTooltip extends React.Component {
  static contextType = ResourcesContext;
  render() {
    return (
      <Card style={this.props.style}>
        <CardHeader>{this.props.ts.toISOString()}: <b>{this.props.value}</b> ms</CardHeader>
        <CardBody>
          <PidInfo pid={this.context.pids[this.props.id]} pids={this.context.pids} />
        </CardBody>
        <CardFooter>{this.props.value}</CardFooter>
      </Card>)
  }
}



const Summary = function(props) {
  const { infos } = props

  return (
    <Flex>
      <FlexItem>
        <Card>
          <CardBody>
            <List>
              <ListItem>Started: {infos.start.toTimeString()}</ListItem>
              <ListItem>Duration: <b>{infos.end}</b>sec</ListItem>
              <ListItem>Sampling: <b>{Math.floor(1000 / infos.interval)}</b>Hz</ListItem>
              <ListItem>Processes: <b>{Object.keys(infos.pids).length}</b></ListItem>
              <ListItem>CGroups: <b>{Object.keys(infos.cgroups).length}</b></ListItem>
            </List>
          </CardBody>
        </Card>
      </FlexItem>
      <FlexItem>
        <Card>
          <CardHeader>Total CPU time</CardHeader>
          <CardBody><b>{Math.round(infos.cpu_total)}</b> ms</CardBody>
        </Card>
      </FlexItem>
      <FlexItem>
        <Card>
          <CardHeader>Total MEM reserved</CardHeader>
          <CardBody><b>TBD</b> MB</CardBody>
        </Card>
      </FlexItem>
      <FlexItem>
        <Card>
          <CardHeader>Top 5 CPU CGroup</CardHeader>
          <CardBody>
            <Bars width={300} data={infos.cgroupsCpu.slice(0, 5)} />
          </CardBody>
        </Card>
      </FlexItem>
      <FlexItem>
        <Card>
          <CardHeader>Top 5 CPU processes</CardHeader>
          <CardBody>
            <Bars width={300} data={infos.pidsCpu.slice(0, 5)} />
          </CardBody>
        </Card>
      </FlexItem>
      <FlexItem>
        <Card /* Margin ensure tooltip can be scrolled to... */ style={{marginBottom: '200px'}}>
          <CardHeader>Processes over time</CardHeader>
          <CardBody>
            <HeatMap width={1700}
                     infos={infos}
            />
          </CardBody>
        </Card>
      </FlexItem>
    </Flex>
  )
}

const App = function(props, a, b, c) {
  const [activeItem, setActive] = useState(0);
  console.log("Main struct", props.infos)

  const Items = [
    ["Summary", "Build trace informations",
     <Summary infos={props.infos} />,
    ],
    ["CGroups", "Cgroups list", <Cgroups cgroupsCpu={props.infos.cgroupsCpu} />],
    ["Process", "Pid list", <Processes pidsCpu={props.infos.pidsCpu} root={props.infos.root_pid} />],
    ["Graphs", "WIP graphs", (<Tree data={props.infos.root_pid} />)]
  ];

  const NavItems = (
    <Nav onSelect={(res) => {setActive(res.itemId)}} aria-label="Nav" theme="dark">
      <NavList variant={NavVariants.horizontal}>
        {Items.map((item, idx) => (<NavItem key={idx} itemId={idx} isActive={activeItem === idx}>{item[0]}</NavItem>))}
      </NavList>
    </Nav>
  )
    const Header = (
      <PageHeader
        logo="ci-tracer logo"
        topNav={NavItems}
      />
  );
  return (
    <Page header={Header}>
      <PageSection variant={PageSectionVariants.light}>
        <TextContent>
          <Text component="h1">{Items[activeItem][0]}</Text>
          <Text component="p">{Items[activeItem][1]}</Text>
        </TextContent>
      </PageSection>
      {Items[activeItem].slice(2).map((e, idx) => (<PageSection key={idx}>{e}</PageSection>))}
    </Page>
  );
}

function process(data) {
  // Normalize time serie data
  var result = {cpu_total: 0.0, dates: [], cpu_max: 0}
  var pids = {}
  var cgroups = {}

  // List[List[Tuple[cpu time, pid]]]
  var cpus = []
  // Dict[cgroup id, cgroup name]
  var pidsCgroup = {}

  var cpu = []
  data.forEach((event) => {
    if (event.interval !== undefined) {
      result.interval = event.interval
    } else if (event.start !== undefined) {
      result.start = new Date(0)
      result.start.setUTCSeconds(event.start)
    } else if (event.end !== undefined) {
      result.end = event.end
    } else if (event.cgr !== undefined) {
      // New Cgroup
      if (Object.keys(cgroups).indexOf(event.v) === -1) {
        cgroups[event.cgr] = {id: event.cgr, name: event.v, pids: [], cpu_total: 0.0, cpu_events: []}
      }
      // One cgroup may have multiple id when it is recreated
      // result.cgroupsIdName[event.cgr] = event.v
    } else if (event.pid !== undefined) {
      // New PID
      if (pids[event.pid] !== undefined) {
        // TODO: take care of that
        console.warn(event.pid, "got recycled, was:", pids[event.pid])
      }
      event.children = []
      event.cpu_events = []
      event.cpu_total = 0.0
      event.created = new Date(result.start.getTime() + event.t * 1000)
      event.id = event.pid
      event.name = event.v[0]
      event.args = event.v.slice(1).join(" ").slice(0, 80) // slice because table x-scroll doesn't work

      pids[event.pid] = event
      pidsCgroup[event.pid] = event.cg
      cgroups[event.cg].pids.push(event.pid)
      if (result.root_pid === undefined) {
        result.root_pid = event
      } else if (pids[event.ppid] !== undefined) {
        pids[event.ppid].children.push(event)
      } else {
        // Default attach to root pid
        result.root_pid.children.push(event)
        // console.warn(event.pid, "parent doesn't exist:", event.ppid)
      }
    } else if (event.ts !== undefined) {
      // New serie of cpu measure begin
      result.dates.push(new Date(result.start.getTime() + event.ts * 1000))
      cpus.push(cpu)
      cpu = []
    } else if (event.cpu !== undefined) {
      // One cpu measures
      result.cpu_total += event.v
      if (event.v > result.cpu_max) {
        result.cpu_max = event.v
      }
      cpu.push([event.cpu, event.v])
    } else if (Object.keys(event).length > 0) {
      console.error("Unknown event", event)
    }
  })

  result.cpu_events = new Array(cpus.length).fill(0);

  // Process cpu measures
  cpus.forEach((step, idx) => {
    const cgroups_sum = {}
    step.forEach((cpu) => {
      const pid = pids[cpu[0]]
      const value = cpu[1]

      result.cpu_events[idx - 1] += value
      if (pid === undefined) {
        console.error("Unknown pid", cpu[0])
        return
      }
      pid.cpu_events.push([idx - 1, value])
      pid.cpu_total += value

      if (cgroups_sum[pid.cg] === undefined) {
        cgroups_sum[pid.cg] = 0
      }
      cgroups_sum[pid.cg] += value
    })
    Object.entries(cgroups_sum).forEach(cgsum => {
      cgroups[cgsum[0]].cpu_events.push([idx - 1, cgsum[1]])
      cgroups[cgsum[0]].cpu_total += cgsum[1]
    })
  })


  // Finalize result object
  result.samples = cpus.length
  result.cgroups = cgroups
  result.pids = pids
  result.pidsCpu = []
  result.cgroupsCpu = []
  Object.values(pids).sort((a, b) => a.cpu_total < b.cpu_total).forEach(pid => {
    result.pidsCpu.push(pid)
  })
  Object.values(cgroups).sort((a, b) => a.cpu_total < b.cpu_total).forEach(cgroup => {
    result.cgroupsCpu.push(cgroup)
  })

  /*
  // Create dense array for top cgroups and process
  result.cgroupsCpu.slice(0, 80).forEach(cg => {
    cg.cpu_data = new Array(cpus.length).fill(0);
    cg.pids.forEach(pid => {
      pids[pid].cpu_events.forEach(event => {
        cg.cpu_data[event[0]] += event[1]
      })
    })
  })
  result.pidsCpu.slice(0, 80).forEach(pid => {
    pid.cpu_data = new Array(cpus.length).fill(0);
    pid.cpu_events.forEach(event => {
      pid.cpu_data[event[0]] = event[1]
    })
  })
  */
  return result
}

function processTask(data) {
  const tasks = []
  var idx = 0;
  data.forEach(gplay => {
    gplay.plays.forEach(play => {
      play.tasks.forEach(task => {
        const start = new Date(task.task.duration.start)
        // const end = new Date(task.task.duration.end)
        tasks.push({date: start, label: task.task.name, idx: idx})
        idx += 1
      })
    })
  })
  Axios.get('ci-tracer.json').then(response => {
    const infos = process(response.data)
    infos.tasks = tasks
    ReactDOM.render(
      <ResourcesContext.Provider value={{pids: infos.pids, cgroups: infos.cgroups}}>
        <App infos={infos} />
      </ResourcesContext.Provider>,
      document.getElementById('root'))
  })
}

Axios.get('job-output.json.gz').then(response => {
  return processTask(response.data)
}).catch(error => {
  // Try without compression
  Axios.get('job-output.json').then(response => {
    return processTask(response.data)
  })
}).catch(error => {
  console.error("Couldn't find job-output")
  return processTask([])
})
