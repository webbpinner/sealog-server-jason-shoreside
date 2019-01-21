'use strict';

const Joi = require('joi');
const fs = require('fs');
const tmp = require('tmp');
const path = require('path');

const {
  CRUISE_PATH,
} = require('../../../config/path_constants');

const {
  cruisesTable,
  loweringsTable
} = require('../../../config/db_constants');

const rmDir = (dirPath) => {
  try { var files = fs.readdirSync(dirPath); }
  catch(e) { return; }
  if (files.length > 0)
    for (var i = 0; i < files.length; i++) {
      var filePath = dirPath + '/' + files[i];
      if (fs.statSync(filePath).isFile())
        fs.unlinkSync(filePath);
      else
        rmDir(filePath);
    }
  fs.rmdirSync(dirPath);
};

const mvFilesToDir = (sourceDirPath, destDirPath) => {
  try { var files = fs.readdirSync(sourceDirPath); }
  catch(e) { return; }
  if (files.length > 0)
    for (var i = 0; i < files.length; i++) {
      var sourceFilePath = sourceDirPath + '/' + files[i];
      var destFilePath = destDirPath + '/' + files[i];
      if (fs.statSync(sourceFilePath).isFile())
        fs.renameSync(sourceFilePath, destFilePath);
      else
        mvFilesToDir(sourceFilePath, destFilePath);
    }
  fs.rmdirSync(sourceDirPath);
};

const _renameAndClearFields = (doc) => {

  //rename id
  doc.id = doc._id;
  delete doc._id;

  return doc;
};


exports.plugin = {
  name: 'routes-api-cruises',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    const db = server.mongo.db;
    const ObjectID = server.mongo.ObjectID;

    server.route({
      method: 'GET',
      path: '/cruises',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = {};

        //Hiddle filtering
        if (typeof(request.query.hidden) !== "undefined"){
          if(request.query.hidden && !request.auth.credentials.scope.includes('admin')) {
            return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve hidden cruises"}).code(401);
          }
          query.cruise_hidden = request.query.hidden;
        } else if(!request.auth.credentials.scope.includes('admin')) {
          query.cruise_hidden = false;
        }

        // Cruise ID filtering... if using this then there's no reason to use other filters
        if (request.query.cruise_id) {
          query.cruise_id = request.query.cruise_id;
        } else {

          //PI filtering
          if (request.query.cruise_pi) {
            query.cruise_pi = request.query.cruise_pi;
          }

          //Location filtering
          if (request.query.cruise_location) {
            query.cruise_location = request.query.cruise_location;
          }

          //Time filtering
          if ((request.query.startTS) || (request.query.stopTS)) {
            let startTS = new Date("1970-01-01T00:00:00.000Z");
            let stopTS = new Date();

            if (request.query.startTS) {
              startTS = new Date(request.query.startTS);
            }

            if (request.query.stopTS) {
              stopTS = new Date(request.query.stopTS);
            }

            query.ts = {"$gte": startTS , "$lt": stopTS };
          }
        }

        let limit = (request.query.limit)? request.query.limit : 0;
        let offset = (request.query.offset)? request.query.offset : 0;

        try {
          const cruises = await db.collection(cruisesTable).find(query).sort( { start_ts: -1 } ).skip(offset).limit(limit).toArray()

          if (cruises.length > 0) {

            let mod_cruises = cruises.map((cruise) => {
              try {
                cruise.cruise_files = fs.readdirSync(CRUISE_PATH + '/' + cruise._id);
              } catch(error) {
                cruise.cruise_files = [];
              }
              return cruise;
            });

            mod_cruises.forEach(_renameAndClearFields);
            return h.response(mod_cruises).code(200);
          } else {
            return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
          }
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }   
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'read_cruises']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          query: Joi.object({
            startTS: Joi.date().iso(),
            stopTS: Joi.date().iso(),
            hidden: Joi.boolean().optional(),
            cruise_id: Joi.string().optional(),
            cruise_location: Joi.string().optional(),
            cruise_pi: Joi.string().optional(),
            offset: Joi.number().integer().min(0).optional(),
            limit: Joi.number().integer().min(1).optional(),
          }).optional(),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            200: Joi.array().items(Joi.object({
              id: Joi.object(),
              cruise_id: Joi.string(),
              cruise_name: Joi.string().allow(''),
              cruise_location: Joi.string().allow(''),
              start_ts: Joi.date().iso(),
              stop_ts: Joi.date().iso(),
              cruise_description: Joi.string().allow(''),
              cruise_pi: Joi.string().allow(''),
              cruise_participants: Joi.array().items(Joi.string().allow('')),
              cruise_files: Joi.array().items(Joi.string()),
              cruise_tags: Joi.array().items(Joi.string().allow('')),
              cruise_hidden: Joi.boolean(),
            })),
            401: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            }),
            404: Joi.object({
              statusCode: Joi.number().integer(),
              message: Joi.string()
            })
          }
        },
        description: 'Return the cruises based on query parameters',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: ['cruises','auth','api'],
      }
    });

    server.route({
      method: 'GET',
      path: '/cruises/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = {}

        try {
          query._id = new ObjectID(request.params.id);
        } catch(err) {
          return h.response({statusCode: 400, error: "Invalid argument", message: "id must be a single String of 12 bytes or a string of 24 hex characters"}).code(400);
        }

        let cruise = null;

        try {
          const result = await db.collection(cruisesTable).findOne(query)
          if (!result) {
            return h.response({ "statusCode": 404, 'message': 'No record found for id: ' + request.params.id }).code(404);
          }

          if (result.cruise_hidden && !request.auth.credentials.scope.includes('admin')) {
            return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve hidden cruises"}).code(401);
          }

          cruise = result;

        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }

        try {
          cruise.cruise_files = fs.readdirSync(CRUISE_PATH + '/' + request.params.id);
        } catch(error) {
          cruise.cruise_files = [];
        }

        cruise = _renameAndClearFields(cruise);
        return h.response(cruise).code(200);
      },
      config: {
        auth:{
          strategy: 'jwt',
          scope: ['admin', 'read_cruises']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: Joi.object({
            id: Joi.string().length(24).required()
          }),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            200: Joi.object({
              id: Joi.object(),
              cruise_id: Joi.string(),
              cruise_name: Joi.string().allow(''),
              cruise_location: Joi.string().allow(''),
              start_ts: Joi.date().iso(),
              stop_ts: Joi.date().iso(),
              cruise_description: Joi.string().allow(''),
              cruise_pi: Joi.string().allow(''),
              cruise_participants: Joi.array().items(Joi.string().allow('')),
              cruise_files: Joi.array().items(Joi.string()),
              cruise_tags: Joi.array().items(Joi.string().allow('')),
              cruise_hidden: Joi.boolean(),
            }),
            401: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            }),
            404: Joi.object({
              statusCode: Joi.number().integer(),
              message: Joi.string()
            }),
            503: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            })
          }
        },
        description: 'Return the cruise based on cruise id',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: ['cruises','auth','api'],
      }
    });

    server.route({
      method: 'POST',
      path: '/cruises',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let cruise = request.payload;

        if(request.payload.id) {
          try {
            cruise._id = new ObjectID(request.payload.id);
            delete cruise.id;
          } catch(err) {
            return h.response({statusCode: 400, error: "Invalid argument", message: "id must be a single String of 12 bytes or a string of 24 hex characters"}).code(400);
          }
        }

        try {
          const result = await db.collection(cruisesTable).insertOne(cruise)

          if (!result) {
            return h.response({ "statusCode": 400, 'message': 'Bad request'}).code(400);
          }

          try {
            fs.mkdirSync(CRUISE_PATH + '/' + result.insertedId);
          } catch(err) {
            console.log(err);
          }

          return h.response({ n: result.result.n, ok: result.result.ok, insertedCount: result.insertedCount, insertedId: result.insertedId }).code(201);

        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'create_cruises']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          payload: {
            id: Joi.string().length(24).optional(),
            cruise_id: Joi.string().required(),
            cruise_name: Joi.string().allow('').required(),
            cruise_description: Joi.string().allow('').required(),
            start_ts: Joi.date().iso().required(),
            stop_ts: Joi.date().iso().required(),
            cruise_pi: Joi.string().allow('').required(),
            cruise_location: Joi.string().allow('').required(),
            cruise_participants: Joi.array().items(Joi.string().allow('')).required(),
            cruise_tags: Joi.array().items(Joi.string().allow('')).required(),
            cruise_hidden: Joi.boolean().required()
          },
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            201: Joi.object({
              n: Joi.number().integer(),
              ok: Joi.number().integer(),
              insertedCount: Joi.number().integer(),
              insertedId: Joi.object()
            }),
            400: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            }),
            401: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            })
          }
        },

        description: 'Create a new event template',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: ['cruises','auth','api'],
      }
    });

    server.route({
      method: 'PATCH',
      path: '/cruises/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = {};

        try {
          query._id = new ObjectID(request.params.id);
        } catch(err) {
          return h.response({statusCode: 400, error: "Invalid argument", message: "id must be a single String of 12 bytes or a string of 24 hex characters"}).code(400);
        }

        let cruise = null;

        try {
          const result = await db.collection(cruisesTable).findOne(query)

          if(!result) {
            return h.response({ "statusCode": 404, 'message': 'No record found for id: ' + request.params.id }).code(404);
          }

          cruise = result;

        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }

        //move files from tmp directory to permanent directory
        if(request.payload.cruise_files) {
          try {
            request.payload.cruise_files.map((file) => {
              // console.log("move files from", path.join(tmp.tmpdir,file), "to", path.join(CRUISE_PATH, request.params.id));
              mvFilesToDir(path.join(tmp.tmpdir,file), path.join(CRUISE_PATH, request.params.id));
            });
          } catch(err) {
            return h.response({ "statusCode": 503, "error": "File Error", 'message': 'unabled to upload files. Verify directory ' + path.join(CRUISE_PATH, request.params.id) + ' exists'  }).code(503);
          }

          delete request.payload.cruise_files;
        }
        
        // console.log("updating cruise");
        try {
          const result = await db.collection(cruisesTable).updateOne(query, { $set: request.payload })
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }

        if(typeof(request.payload.cruise_hidden) !== 'undefined'){
          let query = { start_ts: { "$gte": new Date(cruise.start_ts)}, stop_ts: {"$lt": new Date(cruise.stop_ts)} };
          try {
            const cruiseLowerings = await db.collection(loweringsTable).find(query).toArray()

            cruiseLowerings.forEach((lowering) => {
              try {
                const result = db.collection(loweringsTable).updateOne({_id: lowering._id}, { $set: {lowering_hidden: request.payload.cruise_hidden} })                    
              } catch (err) {
                console.log("ERROR:", err);
                return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
              }
            });
          } catch (err) {
            console.log("ERROR:", err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
          }
        }

        return h.response(result).code(204);
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'write_cruises']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: Joi.object({
            id: Joi.string().length(24).required()
          }),
          payload: Joi.object({
            cruise_id: Joi.string().optional(),
            cruise_name: Joi.string().allow('').optional(),
            start_ts: Joi.date().iso().optional(),
            stop_ts: Joi.date().iso().optional(),
            cruise_description: Joi.string().allow('').optional(),
            cruise_location: Joi.string().allow('').optional(),
            cruise_pi: Joi.string().allow('').optional(),
            cruise_participants: Joi.array().items(Joi.string()).optional(),
            cruise_tags: Joi.array().items(Joi.string()).optional(),
            cruise_hidden: Joi.boolean().optional(),
            cruise_files: Joi.array().items(Joi.string()).optional(),
          }).required().min(1),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            404: Joi.object({
              statusCode: Joi.number().integer(),
              message: Joi.string()
            }),
            503: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            })
          }
        },
        description: 'Update a cruise record',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: ['cruises','auth','api'],
      }
    });

    server.route({
      method: 'DELETE',
      path: '/cruises/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = {}

        try {
          query._id = new ObjectID(request.params.id);
        } catch(err) {
          return h.response({statusCode: 400, error: "Invalid argument", message: "id must be a single String of 12 bytes or a string of 24 hex characters"}).code(400);
        }

        try {
          const result = await db.collection(cruisesTable).findOne(query)

          if(!result) {
            return h.response({ "statusCode": 404, 'message': 'No record found for id: ' + request.params.id }).code(404);
          }
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }  

        try {
          const deleteCruise = await db.collection(cruisesTable).deleteOne(query)
          
          if (fs.existsSync(CRUISE_PATH + '/' + request.params.id)) rmDir(CRUISE_PATH + '/' + request.params.id);
          
          return h.response(deleteCruise).code(204);
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'create_cruises']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: Joi.object({
            id: Joi.string().length(24).required()
          }),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            204: Joi.object(),
            404: Joi.object({
              statusCode: Joi.number().integer(),
              message: Joi.string()
            }),
            503: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            })
          }
        },
        description: 'Delete a cruise record',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: [ 'cruises','auth','api'],
      }
    });

    server.route({
      method: 'DELETE',
      path: '/cruises/all',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = {};

        try {
          const result = await db.collection(cruisesTable).deleteMany(query)

          rmDir(CRUISE_PATH);
          if (!fs.existsSync(CRUISE_PATH)) fs.mkdirSync(CRUISE_PATH);

          return h.response(result).code(204);
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            204: Joi.object(),
            503: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            })
          }
        },
        description: 'Delete a cruise record',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: [ 'cruises','auth','api'],
      }
    });
  }
};