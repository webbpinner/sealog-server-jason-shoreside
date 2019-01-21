'use strict';

const Joi = require('joi');
const fs = require('fs');
const tmp = require('tmp');
const path = require('path');

const {
  LOWERING_PATH,
} = require('../../../config/path_constants');

const {
  loweringsTable,
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
  // delete doc.event_id;

  // if(doc.aux_data && doc.aux_data.length > 0) {
  //   doc.aux_data.forEach(_renameAndClearFields);
  // }

  return doc;
};


exports.plugin = {
  name: 'routes-api-lowerings',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    server.route({
      method: 'GET',
      path: '/lowerings',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = {};

        //Hiddle filtering
        if (typeof(request.query.hidden) !== "undefined"){
          if(request.query.hidden && !request.auth.credentials.scope.includes('admin')) {
            return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve hidden lowerings"}).code(401);
          }
          query.lowering_hidden = request.query.hidden;
        } else if(!request.auth.credentials.scope.includes('admin')) {
          query.lowering_hidden = false;
        }

        // Cruise ID filtering... if using this then there's no reason to use other filters
        if (request.query.lowering_id) {
          query.lowering_id = request.query.lowering_id;
        } else {

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
          const results = await db.collection(loweringsTable).find(query).sort( { start_ts: -1 } ).skip(offset).limit(limit).toArray()
          // console.log("results:", results);

          if (results.length > 0) {

            let mod_results = results.map((result) => {
              try {
                result.lowering_files = fs.readdirSync(LOWERING_PATH + '/' + result._id);
              } catch(error) {
                result.lowering_files = [];
              }
              return result;
            });

            mod_results.forEach(_renameAndClearFields);
            return h.response(mod_results).code(200);
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
          scope: ['admin', 'read_lowerings']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          query: Joi.object({
            lowering_id: Joi.string().optional(),
            startTS: Joi.date().iso(),
            stopTS: Joi.date().iso(),
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
              lowering_id: Joi.string(),
              start_ts: Joi.date().iso(),
              stop_ts: Joi.date().iso(),
              lowering_description: Joi.string().allow(''),
              lowering_files: Joi.array().items(Joi.string()),
              lowering_tags: Joi.array().items(Joi.string().allow('')),
              lowering_location: Joi.string().allow(''),
              lowering_hidden: Joi.boolean(),
            })),
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
        description: 'Return the lowerings based on query parameters',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: ['lowerings','auth','api'],
      }
    });

    server.route({
      method: 'GET',
      path: '/lowerings/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = { _id: new ObjectID(request.params.id) };

        try {
          const result = await db.collection(loweringsTable).findOne(query)
          if (!result) {
            return h.response({ "statusCode": 404, 'message': 'No record found for id: ' + request.params.id }).code(404);
          }

          if (result.lowering_hidden && !request.auth.credentials.scope.includes('admin')) {
            return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve hidden lowerings"}).code(401);
          }

          let mod_result = result
          try {
            mod_result.lowering_files = fs.readdirSync(LOWERING_PATH + '/' + request.params.id);
          } catch(error) {
            mod_result.lowering_files = [];
          }

          mod_result = _renameAndClearFields(result);
          return h.response(mod_result).code(200);
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        auth:{
          strategy: 'jwt',
          scope: ['admin', 'read_lowerings']
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
              lowering_id: Joi.string(),
              start_ts: Joi.date().iso(),
              stop_ts: Joi.date().iso(),
              lowering_description: Joi.string().allow(''),
              lowering_files: Joi.array().items(Joi.string()),
              lowering_tags: Joi.array().items(Joi.string().allow('')),
              lowering_location: Joi.string().allow(''),
              lowering_hidden: Joi.boolean(),
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
            }),
            404: Joi.object({
              statusCode: Joi.number().integer(),
              message: Joi.string()
            })
          }
        },
        description: 'Return the lowering based on lowering id',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: ['lowerings','auth','api'],
      }
    });

    server.route({
      method: 'POST',
      path: '/lowerings',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let lowering = request.payload;

        if(request.payload.id) {
          try {
            lowering._id = new ObjectID(request.payload.id);
            delete lowering.id;
          } catch(err) {
            return h.response({statusCode: 400, error: "Invalid argument", message: "id must be a single String of 12 bytes or a string of 24 hex characters"}).code(400);
          }
        }

        try {
          const result = await db.collection(loweringsTable).insertOne(lowering);

          if (!result) {
            return h.response({ "statusCode": 400, 'message': 'Bad request'}).code(400);
          }

          try {
            fs.mkdirSync(LOWERING_PATH + '/' + result.insertedId);
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
          scope: ['admin', 'create_lowerings']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          payload: {
            id: Joi.string().length(24).optional(),
            lowering_id: Joi.string().required(),
            start_ts: Joi.date().iso().required(),
            stop_ts: Joi.date().iso().required(),
            lowering_description: Joi.string().allow('').required(),
            lowering_tags: Joi.array().items(Joi.string().allow('')).required(),
            lowering_location: Joi.string().allow('').required(),
            lowering_hidden: Joi.boolean().required(),
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
        tags: ['lowerings','auth','api'],
      }
    });

    server.route({
      method: 'PATCH',
      path: '/lowerings/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = { _id: new ObjectID(request.params.id) };

        try {

          const result = await db.collection(loweringsTable).findOne(query)

          if(!result) {
            return h.response({ "statusCode": 400, "error": "Bad request", 'message': 'No record found for id: ' + request.params.id }).code(400);
          }
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }

        if(request.payload.lowering_files) {
          //move files from tmp directory to permanent directory
          try {
            request.payload.lowering_files.map((file) => {
              // console.log("move files from", path.join(tmp.tmpdir,file), "to", path.join(LOWERING_PATH, request.params.id));
              mvFilesToDir(path.join(tmp.tmpdir,file), path.join(LOWERING_PATH, request.params.id));
            });
          } catch(err) {
            // console.log(err)
            return h.response({ "statusCode": 503, "error": "File Error", 'message': 'unabled to upload files. Verify directory ' + path.join(LOWERING_PATH, request.params.id) + ' exists'  }).code(503);
          }
          
          delete request.payload.lowering_files;
        }

        try {

          const result = await db.collection(loweringsTable).updateOne(query, { $set: request.payload })

            return h.response(result).code(204);

        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'write_lowerings']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: Joi.object({
            id: Joi.string().length(24).required()
          }),
          payload: Joi.object({
            lowering_id: Joi.string().optional(),
            start_ts: Joi.date().iso().optional(),
            stop_ts: Joi.date().iso().optional(),
            lowering_description: Joi.string().allow('').optional(),
            lowering_tags: Joi.array().items(Joi.string().allow('')).optional(),
            lowering_location: Joi.string().allow('').optional(),
            lowering_hidden: Joi.boolean().optional(),
            lowering_files: Joi.array().items(Joi.string()).optional(),
          }).required().min(1),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
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
        description: 'Update a lowering record',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: ['lowerings','auth','api'],
      }
    });

    server.route({
      method: 'DELETE',
      path: '/lowerings/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = { _id: new ObjectID(request.params.id) };

        try {
          const result = await db.collection(loweringsTable).findOne(query)
          if(!result) {
            return h.response({ "statusCode": 404, 'message': 'No record found for id: ' + request.params.id }).code(404);
          }
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }

        try {
          const result = await db.collection(loweringsTable).deleteOne(query)
          return h.response(result).code(204);
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'create_lowerings']
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
        description: 'Delete a lowering record',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: [ 'lowerings','auth','api'],
      }
    });

    server.route({
      method: 'DELETE',
      path: '/lowerings/all',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = { };

        try {
          const result = await db.collection(loweringsTable).deleteMany(query)

          try {
            rmDir(LOWERING_PATH);
            if (!fs.existsSync(LOWERING_PATH)) fs.mkdirSync(LOWERING_PATH);
          } catch(err) {
            console.log("ERROR:", err);
            return h.response({statusCode: 503, error: "filesystem error", message: "unable to delete lowering files"}).code(503);  
          }

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
        description: 'Delete a lowering record',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong></p>',
        tags: [ 'lowerings','auth','api'],
      }
    });
  }
};