'use strict';
var test = require('assert');

const {
  cruisesTable,
} = require('../config/db_constants');

exports.plugin = {
  name: 'db_populate_cruises',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    const db = server.mongo.db;
    const ObjectID = server.mongo.ObjectID;

    console.log("Searching for Cruises Collection");
    try {
      const result = await db.listCollections({name:cruisesTable}).toArray()
      if(result) {
        console.log("Collection already exists");
        return true
      }
    } catch(err) {
      console.log("ERROR:", err.code)
      throw(err)
    }

    console.log("Creating Cruises Collection");
    try {
      const result = await db.createCollection(cruisesTable)
      return true
    } catch(err) {
      console.log("ERROR:", err.code)
      throw(err)
    }
  }
};