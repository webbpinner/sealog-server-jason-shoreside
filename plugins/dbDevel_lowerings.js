'use strict';
var test = require('assert');

const {
  loweringsTable,
} = require('../config/db_constants');

exports.plugin = {
  name: 'db_populate_lowerings',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    const db = server.mongo.db;
    const ObjectID = server.mongo.ObjectID;

    const test_data = [
      {
        _id: ObjectID('5981f167212b348aed7fa9f5'),
        lowering_id: '4928',
        start_ts: new Date("2017/06/14 18:00:00Z"),
        stop_ts: new Date("2017/06/15 02:00:00Z"),
        lowering_description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
        lowering_location: "Jaco Scar, Costa Rica",
        lowering_tags: ["engineering"],
        lowering_hidden: false
      },
      {
        _id: ObjectID('5981f167212b348aed7fa9f6'),
        lowering_id: '4929',
        start_ts: new Date("2017/06/15 18:00:00Z"),
        stop_ts: new Date("2017/06/16 02:00:00Z"),
        lowering_description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
        lowering_location: "Jaco Scar, Costa Rica",
        lowering_tags: ["engineering"],
        lowering_hidden: false
      },
      {
        _id: ObjectID('5981f167212b348aed7fa9f7'),
        lowering_id: '4930',
        start_ts: new Date("2017/06/22 18:00:00Z"),
        stop_ts: new Date("2017/06/23 02:00:00Z"),
        lowering_description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
        lowering_location: "4500m site nw of Mayaguana Is, Costa Rica",
        lowering_tags: ["engineering"],
        lowering_hidden: false
      },
      {
        _id: ObjectID('5981f167212b348aed7fa9f8'),
        lowering_id: '4906',
        start_ts: new Date("2017/05/21 18:00:00Z"),
        stop_ts: new Date("2017/05/22 02:00:00Z"),
        lowering_description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
        lowering_location: "Mound 12, Costa Rica",
        lowering_tags: ["coral"],
        lowering_hidden: false
      },
      {
        _id: ObjectID('5981f167212b348aed7fa9f9'),
        lowering_id: '4907',
        start_ts: new Date("2017/05/22 18:00:00Z"),
        stop_ts: new Date("2017/05/23 02:00:00Z"),
        lowering_description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
        lowering_location: "Mound 12, Costa Rica",
        lowering_tags: ["coral"],
        lowering_hidden: false
      },
      {
        _id: ObjectID('5981f167212b348aed7fa9fa'),
        lowering_id: '4908',
        start_ts: new Date("2017/05/23 18:00:00Z"),
        stop_ts: new Date("2017/05/24 02:00:00Z"),
        lowering_description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
        lowering_location: "Mound 12, Costa Rica",
        lowering_tags: ["coral"],
        lowering_hidden: false
      },
      {
        _id: ObjectID('5981f167212b348aed7fa9fb'),
        lowering_id: '4790',
        start_ts: new Date("2015/06/20 13:11:54Z"),
        stop_ts: new Date("2015/06/20 19:58:06Z"),
        lowering_description: "We started at 8:15 AM EST at the dive location \"Mound 1.\" Navigation issues occurred but we soon found our way to the supposed mud volcano. However, the site was less exciting than we hoped and we made a long transit to \"Mound 2.\" Here we found carbonates and collected a push core, a live mussel, a niskin water sample, and even tested Frank's soft robotic grabber. Next we had another long transit to \"Seep 7\" but we had to search for a while before finding the seep itself. We eventually did and took more samples. We made our way to \"Seep 5\" but on the way stumbled across brine puddles. We took four more push cores and another niskin water sample and then explored until 4:00 PM EST, which is when we began ascent.",
        lowering_location: "Gulf of Mexico",
        lowering_tags: [],
        lowering_hidden: false
      }
    ];

    console.log("Searching for Lowerings Collection");
    try {
      const result = await db.listCollections({name:loweringsTable}).toArray()
      if(result[0]) {
        console.log("Lowerings Collection is present... dropping it");
        try {
          await db.dropCollection(loweringsTable)
        } catch(err) {
          console.log("DROP ERROR:", err.code)
          throw(err)
        }
      }
    } catch(err) {
      console.log("LIST ERROR:", err.code)
      throw(err)
    }

    try {
      console.log("Creating Lowerings Collection");
      const collection = await db.createCollection(loweringsTable)

      console.log("Populating Lowerings Collection");
      await collection.insertMany(test_data)

      return true
    } catch(err) {
      console.log("CREATE ERROR:", err.code)
      throw(err)
    }
  }
}
