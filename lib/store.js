'use strict';
// Tiny JSON-file store. Writes are atomic (temp file + rename) and debounced.

const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.data = { tournaments: {} };
    this.timer = null;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!this.data.tournaments) this.data.tournaments = {};
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Could not read data file, starting empty:', e.message);
    }
  }

  list() {
    return Object.values(this.data.tournaments).sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id) {
    return this.data.tournaments[id] || null;
  }

  put(t) {
    this.data.tournaments[t.id] = t;
    this.save();
  }

  remove(id) {
    delete this.data.tournaments[id];
    this.save();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = Store;
