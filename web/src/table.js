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

import React from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  sortable,
  SortByDirection,
  TableVariant,
} from '@patternfly/react-table';

export class SortableTable extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      columns: props.columns.map(col => {
        const column = {}
        if (col.title) {
          column.title = col.title
          if (col.sort) {
            column.transforms = [sortable]
          }
          if (col.class) {
            column.props = {className: "overflow"}
          }
        } else {
          column.title = col
        }
        return column
      }),
      sortBy: {}
    };

    this.state.rows = props.rows.map(row => ({cells: this.state.columns.map(
      col => col.title === "created" ? row[col.title].toISOString() : row[col.title])}))
    this.onSort = this.onSort.bind(this);
  }

  onSort(_event, index, direction) {
    const sortedRows = this.state.rows.sort((a, b) => (a[index] < b[index] ? -1 : a[index] > b[index] ? 1 : 0));
    this.setState({
      sortBy: {
        index,
        direction
      },
      rows: direction === SortByDirection.asc ? sortedRows : sortedRows.reverse()
    });
  }

  render() {
    const { columns, rows, sortBy } = this.state;

    return (
      <Table
        variant={TableVariant.compact}
        aria-label="label"
        sortBy={sortBy}
        onSort={this.onSort}
        cells={columns}
        rows={rows}>
        <TableHeader />
        <TableBody />
      </Table>
    );
  }
}
