'use strict';
var test = require('assert');

const {
  eventAuxDataTable,
} = require('../config/db_constants');

exports.plugin = {
  name: 'db_populate_event_aux_data',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    const db = request.mongo.db;
    const ObjectID = request.mongo.ObjectID;

    console.log("Searching for Event Aux Data Collection");
    try {
      const result = await db.listCollections({name:eventAuxDataTable}).toArray()
      if(result) {
        console.log("Collection already exists");
        return true
      }
    } catch(err) {
      console.log("ERROR:", err.code)
      throw(err)
    }

    console.log("Creating Event Aux Data Collection");
    try {
      const result = await db.createCollection(eventAuxDataTable)
      return true
    } catch(err) {
      console.log("ERROR:", err.code)
      throw(err)
    }
  }
};