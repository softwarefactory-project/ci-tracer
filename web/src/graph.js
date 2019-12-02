/* global require */
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

import * as React from 'react'

// Event needs to be live-binding or something...
import { event } from 'd3-selection'

const d3 = {
  ...require('d3-array'),
  ...require('d3-axis'),
  ...require('d3-brush'),
  ...require('d3-hierarchy'),
  ...require('d3-interpolate'),
  ...require('d3-scale'),
  ...require('d3-scale-chromatic'),
  ...require('d3-selection'),
  ...require('d3-shape'),
  ...require('d3-time-format'),
}


// TODO: investigate faux-dom e.g. https://github.com/tibotiber/rd3
class D3 extends React.Component {
  state = {x: 0, y: 0}

  componentDidMount(a, b) {
    this.create()
  }

  _onMouseMove(e) {
    // Keep track of mouse movement to position tooltip
    this.setState({ x: e.pageX, y: e.pageY });
  }

  render() {
    const Tooltip = this.props.tooltip
    let style = {}
    if (this.state.selected) {
      const w = 500, h = 200
      style = {
        display: 'block',
        background: 'white',
        opacity: 0.8,
        position: 'absolute',
        textAlign: 'left',
        zIndex: '1000',
        width: w,
        left: (this.state.x < w) ? (this.state.x + 10) : (this.state.x - w - 10),
        top: this.state.y
      }
    }
    return (
      <center>
        {this.state.selected && (
          <Tooltip
            style={style}
            id={this.state.selected.id}
            ts={this.state.selected.ts}
            value={this.state.selected.value} />
        )}
        <svg
          onMouseMove={this._onMouseMove.bind(this)}
          style={{font: '14px sans-serif'}}
          ref={node => this.node = node}
        />
      </center>
    )
  }
}


export class Bars extends D3 {
  create() {
    const { data, width } = this.props
    const height = 50 + data.length * 20,

          // set the ranges
          y = d3.scaleBand().range([0, data.length * 20]),
          x = d3.scaleLinear().range([0, width]),

          svg = d3.select(this.node)
          .attr("width", width + 100)
          .attr("height", height)
          .append("g")
          // Reduce chart area to leave room for the legend
          .attr("transform", "translate(50,20)"),

          myColor = d3.scaleOrdinal()
          .domain(data.map(d => d.id))
          .range(d3.schemeAccent);

    y.domain(data.map(d => (d.id))).padding(0.1);
    x.domain([0, d3.max(data, d => (d.cpu_total))]);

    const tooltip = svg.append("g")
        .style("z-index", "10000")
        .style("display", "none");
    tooltip.append("rect")
      .attr("fill", "white")
    tooltip.append("text")

    svg.selectAll(".bar")
      .data(data)
      .enter().append("rect")
      .attr("class", "bar")
      .attr("opacity", .85)
      .attr("x", 0)
      .attr("y", d => (y(d.id)))
      .attr("height", y.bandwidth())
      .attr("width", d => (x(d.cpu_total)))
      .attr("fill", d => myColor(d.id))
      .on('mousemove', function (d) {
        const x = d3.mouse(this)[0]
        d3.select(this).attr('opacity', 1)
        tooltip.select("text").text(d.name)
        tooltip
          .style("display", null)
          .attr("transform", "translate(" + (x + 10) + "," + (12 + y(d.id)) + ")")
      })
      .on('mouseleave', function (d) {
        d3.select(this).attr('opacity', .85)
        tooltip.style("display", "none")
      })


    // Add the x Axis
    svg.append("g")
      .call(d3.axisTop(x));

    // add the y Axis
    svg.append("g")
      .call(d3.axisLeft(y).tickSize(0))
      .selectAll('text')

    tooltip.raise()
  }
}

export class HeatMap extends D3 {
  create() {
    console.log("Creating heat map...")
    const { tasks, dates, data, navData, width, interval } = this.props
    const startDate = dates[0],
          endDate = dates[dates.length - 1],
          navHeight = 50,
          navTopMargin = 20,
          navBottomMargin = 10,
          navY = d3.scaleLinear().range([navHeight, 0]).domain([0, d3.max(navData)]),
          navX = d3.scaleUtc().range([0, width]).domain([startDate, endDate]),
          margin = { top: 60 + navTopMargin + navBottomMargin + navHeight, right: 70, bottom: 0, left: 40 },
          myColor = d3.interpolateReds,
          rowHeight = 10,
          height = data.length * rowHeight,
          y = d3.scaleBand().range([0, height]).domain(data.map(d => (d.id))).padding(0.1),
          x = d3.scaleUtc().range([0, width]).domain([startDate, endDate]),
          notes = tasks.filter(t => t.date > startDate && t.date < endDate)

    // Main drawing area is rootsvg
    const rootsvg = d3.select(this.node)
          .attr("width", width + margin.left + margin.right)
          .attr("height", height + margin.top + margin.bottom)

    /*
     * Navigation bar
     */
    const nav = rootsvg.append("g")
          .attr("transform", "translate(" + margin.left + "," + navTopMargin + ")")

    nav.append("g")
      .call(d3.axisTop(navX).tickFormat(d3.timeFormat("%H:%M:%S")))

    // Add global cpu times line graph
    nav.append("path")
      .datum(navData)
      .attr("fill", "none")
      .attr("stroke", "steelblue")
      .attr("stroke-width", 1.5)
      .attr("d", d3.line()
            .x((d,i) => navX(dates[i]))
            .y(d => navY(d)))
    nav.selectAll('.notes')
      .data(notes)
      .enter().append("line")
      .attr('class', 'notes')
      .style("stroke", "black")
      .style("stroke-width", 0.3)
      .attr("x1", d => (navX(d.date)))
      .attr("x2", d => (navX(d.date)))
      .attr("y1", 0)
      .attr("y2", navHeight)

    // Define selection brush over nav bar
    const brush = d3.brushX()
          .extent([[0, 0], [width, navHeight]])
          .on("end", brushend)

    function brushend() {
      if (!event.selection)
        return
      x.domain(event.selection.map(navX.invert))

      // Animate x axis rescale
      var t = svg.transition().duration(750);
      svg.select(".axis--x").transition(t).call(xAxis)

      // Call redraw to move objects
      redraw()
    }


    /*
     * Heat map
     */
    const svg = rootsvg.append("g")
          .attr("transform", "translate(" + margin.left + "," + margin.top + ")")

    const xAxis = d3.axisTop(x).tickFormat(d3.timeFormat("%H:%M:%S"))

    svg.append("g")
      .attr("class", "axis axis--x")
      .call(xAxis)

    // Create main objects
    const row = svg.selectAll('.row')
          .data(data)
          .enter()
          .append('svg:g')
          .attr('class', 'row')

    const cell = row.selectAll('.cell')
        .data(d => d.cpu_events.map(e => ({
          y: d.id, x: dates[e[0]], v: e[1]
        })))
        .enter().append('rect')
        .attr('class', 'cell')
        .on('mouseenter', d => {this.setState({selected: {id: d.y, value: d.v, ts: d.x}})})
          .on('mouseleave', d => {this.setState({selected: null})})

    const notesLines = svg.selectAll('.notes')
        .data(notes)
        .enter().append("line")
        .attr('class', 'notes')
        .style("stroke", "black")
          .style("stroke-width", 0.3)

    const notesLabels = svg.selectAll('.notes-label')
        .data(notes)
        .enter().append("text")
        .attr('class', 'notes-label')
        .style("font-size", "12px")

    // Redraw sets object coordinates
    function redraw () {
      const domain = x.domain(),
            bw = width / ((domain[1] - domain[0]) / interval)
      console.log("Redraw called", x.domain())
      cell
        .attr('x', d => x(d.x) + 1)
        .attr('y', d => y(d.y))
        .attr('width', bw)
        .attr('height', rowHeight)
        .attr('fill', d => myColor(d.v / interval))

      notesLines
        .attr("x1", d => (x(d.date)))
        .attr("x2", d => (x(d.date)))
        .attr("y1", -50)
        .attr("y2", height)

      notesLabels
        .attr("x", d => x(d.date))
        .attr("y", d => -50 + (d.idx & 3) * 10)
        .text(d => d.label)
    }

    const yTicks = svg.append("g")
      .call(d3.axisLeft(y).tickSize(0))

    // TODO: make background solid instead of over the cells rectangle
    yTicks.selectAll('text')
      .attr('fill', 'black')
      .attr('background', 'white')

    // Add the brush at the end to set the initial range and trigger the redraw
    nav.append("g")
      .attr("class", "brush")
      .call(brush)
      .call(brush.move, x.range())
  }
}

export class Tree extends D3 {
  create() {
    function autoBox() {
      const {x, y, width, height} = this.getBBox();
      return [x, y, width, height];
    }
    const data = this.props.data
    const svg = d3.select(this.node)
    const width = 800, height = 800
    svg.attr('width', width).attr('height', height)
      .style("max-width", "100%")
      .style("height", "auto")
      .style("font", "10px sans-serif")
      .style("margin", "5px")


    const color = d3.scaleOrdinal(d3.quantize(d3.interpolateRainbow, data.children.length + 4))

    // sunburst
    const radius = width / 2
    const root = d3.partition()
    .size([2 * Math.PI, radius])(d3.hierarchy(data)
     .sum(d => d.cpu_total)
     .sort((a, b) => b.cpu_total - a.cpu_total))

    const a = d3.arc()
          .startAngle(d => d.x0)
          .endAngle(d => d.x1)
          .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
          .padRadius(radius / 2)
          .innerRadius(d => d.y0)
          .outerRadius(d => d.y1 - 1)

  svg.append("g")
      .attr("fill-opacity", 0.6)
      .selectAll("path")
      .data(root.descendants().filter(d => d.depth))
      .enter().append("path")
      .attr("fill", d => { while (d.depth > 1) d = d.parent; return color(d.data.name); })
      .attr("d", a)
      .append("title")
      .text(d => `${d.ancestors().map(d => d.data.name).reverse().join(" -> ")}`);

    svg.append("g")
      .attr("pointer-events", "none")
      .attr("text-anchor", "middle")
      .selectAll("text")
      .data(root.descendants().filter(d => d.depth && (d.y0 + d.y1) / 2 * (d.x1 - d.x0) > 10))
      .enter().append("text")
      .attr("transform", function(d) {
        const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
        const y = (d.y0 + d.y1) / 2;
        return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
      })
      .attr("dy", "0.35em")
      .text(d => d.data.pid);

    svg.attr("viewBox", autoBox)
    return
  }

}
