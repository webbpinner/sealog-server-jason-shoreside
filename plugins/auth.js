const SECRET_KEY = require('../config/secret');

const {
  usersTable
} = require('../config/db_constants');

exports.plugin = {
  name: 'auth',
  dependencies: ['hapi-mongodb', 'hapi-auth-jwt2'],
  register: (server, options) => {

    const validateFunction = async (decoded, request) => {

      const db = request.mongo.db;
      const ObjectID = request.mongo.ObjectID;

      try {
        const result = await db.collection(usersTable).findOne({ _id: new ObjectID(decoded.id) });
        if (!result) {
          return { isValid: false };
        }
        else if ( result.roles.toString() !== decoded.roles.toString() ) {
          // console.log("Roles didn't match")
          return { isValid: false };
        }

        // console.log("Setting last_login")
        await db.collection(usersTable).updateOne({ _id: new ObjectID(decoded.id) }, { $set: { last_login: new Date() } });

        // console.log("returning true")
        return { isValid: true };

      }
      catch (err) {
        console.log("Validation ERROR:");
        return { isValid: false };        
      }
    };

    server.auth.strategy('jwt', 'jwt', {
      key: SECRET_KEY,
      verifyOptions: {
        algorithms: ['HS256']
      },
      // Implement validation function
      validate: validateFunction
    });
  }
};