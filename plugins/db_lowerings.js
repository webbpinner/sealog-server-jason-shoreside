'use strict';
var test = require('assert');

const {
  loweringsTable,
} = require('../config/db_constants');

exports.plugin = {
  name: 'db_populate_lowerings',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    const db = request.mongo.db;
    const ObjectID = request.mongo.ObjectID;

    console.log("Searching for Lowerings Collection");
    try {
      const result = await db.listCollections({name:loweringsTable}).toArray()
      if(result) {
        console.log("Collection already exists");
        return true
      }
    } catch(err) {
      console.log("ERROR:", err.code)
      throw(err)
    }

    console.log("Creating Lowerings Collection");
    try {
      const result = await db.createCollection(loweringsTable)
      return true
    } catch(err) {
      console.log("ERROR:", err.code)
      throw(err)
    }
  }
};