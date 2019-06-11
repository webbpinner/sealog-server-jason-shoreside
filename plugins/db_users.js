

const {
  usersTable
} = require('../config/db_constants');

exports.plugin = {
  name: 'db_populate_users',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    const db = server.mongo.db;
    const ObjectID = server.mongo.ObjectID;

    const init_data = [
      {
        _id: ObjectId("5981f167212b348aed7fa9f5"),
        username: "admin",
        fullname: "Admin",
        email : "admin@notarealserver.com",
        password: "$2a$10$dg.sG4mJUIapemopyIxltuqpY78WkNcUTbzXjw0OSjyerWOUC01la",
        last_login: new Date(),
        roles: [ "admin", "event_watcher", "event_logger", "event_manager", "cruise_manager" ],
        system_user: true,
        disabled: false,
      },
      {
        _id: ObjectID("5981f167212b348aed7fb9f5"),
        username: "guest",
        fullname: "Guest",
        email: "guest@notarealserver.com",
        password: "$2a$10$oTRayeYC2sOAuW9vapp3Ze6zVFsGyj40cc1XgWv.NL/hGLNi82Whq",
        last_login: new Date(),
        roles: ['event_manager', 'event_logger', 'event_watcher'],
        system_user: true
      },
      {
        _id: ObjectID("5981f167212b348aed7fc9f5"),
        username: "pi",
        fullname: "Primary Investigator",
        email: "pi@notarealserver.com",
        password: "$2a$10$oTRayeYC2sOAuW9vapp3Ze6zVFsGyj40cc1XgWv.NL/hGLNi82Whq",
        last_login: new Date(),
        roles: ['event_manager', 'event_logger', 'event_watcher', 'cruise_manager'],
        system_user: true
      }
    ];

    console.log("Searching for Users Collection");
    try {
      const result = await db.listCollections({ name:usersTable }).toArray();
      if (result.length > 0) {
        console.log("Collection already exists... we're done here.");
        return;
      }
    }
    catch (err) {
      console.log("ERROR:", err.code);
      throw (err);
    }

    try {
      console.log("Creating Users Collection");
      const collection = await db.createCollection(usersTable);

      console.log("Populating Users Collection");
      await collection.insertMany(init_data);

    }
    catch (err) {
      console.log("ERROR:", err.code);
      throw (err);
    }
  }
};