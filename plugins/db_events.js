'use strict';
var test = require('assert');

const {
  eventsTable,
} = require('../config/db_constants');

exports.plugin = {
  name: 'db_populate_events',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    const db = request.mongo.db;
    const ObjectID = request.mongo.ObjectID;

    console.log("Searching for Events Collection");
    try {
      const result = await db.listCollections({name:eventsTable}).toArray()
      if(result) {
        console.log("Collection already exists");
        return true
      }
    } catch(err) {
      console.log("ERROR:", err.code)
      throw(err)
    }

    console.log("Creating Events Collection");
    try {
      const result = await db.createCollection(eventsTable)
      return true
    } catch(err) {
      console.log("ERROR:", err.code)
      throw(err)
    }
  }
};