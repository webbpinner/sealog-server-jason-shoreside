'use strict';
var test = require('assert');

const {
  eventTemplatesTable,
} = require('../config/db_constants');

exports.plugin = {
  name: 'db_populate_event_templates',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    const db = server.mongo.db;
    const ObjectID = server.mongo.ObjectID;

    console.log("Searching for Event Template Collection");
    try {
      const result = await db.listCollections({name:eventTemplatesTable}).toArray()
      if(result) {
        console.log("Collection already exists");
        return true
      }
    } catch(err) {
      console.log("ERROR:", err.code)
      throw(err)
    }

    console.log("Creating Event Template Collection");
    try {
      const result = await db.createCollection(eventTemplatesTable)
      return true
    } catch(err) {
      console.log("ERROR:", err.code)
      throw(err)
    }
  }
};