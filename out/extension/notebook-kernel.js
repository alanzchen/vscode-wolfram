"use strict";
// Copyright 2021 Tianhuan Lu
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionQueue = void 0;
const uuid = require("uuid");
class ExecutionQueue {
    constructor() {
        this.queue = [];
    }
    empty() {
        return this.queue.length === 0;
    }
    clear() {
        this.queue.forEach(item => {
            this.end(item.id, false);
        });
        this.queue = [];
    }
    push(execution) {
        const id = uuid.v4();
        this.queue.push({ id, execution });
        return id;
    }
    findIndex(id) {
        return this.queue.findIndex(item => (item.id === id));
    }
    at(index) {
        return this.queue[index] || null;
    }
    find(id) {
        return this.at(this.findIndex(id));
    }
    remove(id) {
        const index = this.findIndex(id);
        if (index >= 0) {
            this.queue.splice(index, 1);
        }
    }
    start(id) {
        const execution = this.find(id);
        if (execution) {
            execution.execution.start(Date.now());
            execution.started = true;
        }
    }
    end(id, succeed) {
        const execution = this.find(id);
        if (execution) {
            if (!(execution?.started)) {
                execution.execution.start(Date.now());
            }
            execution.execution.end(succeed, Date.now());
            this.remove(id);
        }
    }
    getNextPendingExecution() {
        if (this.queue.length > 0 && !(this.queue[0]?.started)) {
            return this.queue[0];
        }
        else {
            return null;
        }
    }
}
exports.ExecutionQueue = ExecutionQueue;
//# sourceMappingURL=notebook-kernel.js.map