'use strict';

const Joi = require('joi');
const converter = require('json-2-csv');
const extend = require('jquery-extend');

const json2csvOptions = {
  checkSchemaDifferences: false,
  emptyFieldValue: ''
};

const THRESHOLD = 120; //seconds

const {
  eventsTable,
  usersTable,
  eventAuxDataTable,
  loweringsTable,
  cruisesTable
} = require('../../../config/db_constants');


function flattenJSON(json) {
  // console.log("Pre-Export:", this.props.event_export.events)
  let exportData = json.map((event) => {
    let copiedEvent = extend(true, {}, event);

    copiedEvent.event_options.map((data) => {
      let elementName = `event_option_${data.event_option_name}`;
      // console.log(elementName, data.event_option_value);
      copiedEvent[elementName] = data.event_option_value;
    });

    delete copiedEvent.event_options;

    copiedEvent.ts = copiedEvent.ts.toISOString();
    copiedEvent.id = copiedEvent.id.toString();
    return copiedEvent;
  });

  return exportData;
}

const _renameAndClearFields = (doc) => {

  //rename id
  doc.id = doc._id;
  delete doc._id;

  return doc;
};

exports.plugin = {
  name: 'routes-api-events',
  dependencies: ['hapi-mongodb', 'nes'],
  register: async (server, options) => {

    server.subscription('/ws/status/newEvents');
    server.subscription('/ws/status/updateEvents');
    server.subscription('/ws/status/deleteEvents');

    server.route({
      method: 'GET',
      path: '/events/bycruise/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let cruise = null;

        try {
          const cruiseResult = await db.collection(cruisesTable).findOne({ _id: ObjectID(request.params.id) })

          if(!cruiseResult) {
            return h.response({ "statusCode": 404, 'message': 'No record found for id: ' + request.params.id }).code(404);
          }

          cruise = cruiseResult;
        } catch(err) {
           console.log(err)
           return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }

        if(cruise.cruise_hidden && !request.auth.credentials.scope.includes("admin")) {
          return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve hidden cruises"}).code(401);
        }

        let query = {};
        let startTS = new Date(cruise.start_ts);
        let stopTS = new Date(cruise.stop_ts);

        // console.log(request.query);

        //Data source filtering
        if (request.query.datasource) {

          let datasource_query = {};

          if(Array.isArray(request.query.datasource)) {
            datasource_query.data_source  = { $in: request.query.datasource };
          } else {
            datasource_query.data_source  = request.query.datasource;
          }

          try {
            const collection = await db.collection(eventAuxDataTable).find(datasource_query, {_id: 0, event_id: 1}).toArray()

            let eventIDs = collection.map(x => x.event_id);

            query._id = { $in: eventIDs};
          } catch(err) {
            console.log(err)
            return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }

          if(request.query.author) {
            if(Array.isArray(request.query.author)) {
              query.event_author  = { $in: request.query.author };
            } else {
              query.event_author  = request.query.author;
            }
          }

          if(request.query.value) {
            if(Array.isArray(request.query.value)) {

              let inList = [];
              let ninList = [];

              for( let value of request.query.value ) {
                if(value.startsWith("!")) {
                  ninList.push(value.substr(1));
                } else {
                  inList.push(value);
                }
              }
              
              if( inList.length > 0 && ninList.length > 0) {
                query.event_value  = { $in: inList, $nin: ninList };
              } else if (inList.length > 0) {
                query.event_value  = { $in: inList };
              } else {
                query.event_value  = { $nin: ninList };
              }

            } else {
              if(request.query.value.startsWith("!")) {
                query.event_value  = { $ne: request.query.value.substr(1) };
              } else {
                query.event_value  = request.query.value;
              }
            }
          }

          if(request.query.freetext) {

            query.event_free_text = { $regex: `${request.query.freetext}`};
          }

          //Time filtering
          if (request.query.startTS) {
            let tempStartTS = new Date(request.query.startTS);
            let startTS = (tempStartTS >= startTS && tempStartTS <= cruise.stopTS)? tempStartTS : cruise.startTS;
            query.ts = { $gte: startTS }
          }

          if (request.query.stopTS) {
            let tempStopTS = new Date(request.query.stopTS);
            let stopTS = (tempStopTS >= startTS && tempStopTS <= cruise.stopTS)? tempStopTS : cruise.stopTS;
            if(query.ts) {
              query.ts.$lte = stopTS
            } else { 
              query.ts = {"$lte": stopTS}
            }
          }

          query.ts = {"$gte": startTS , "$lte": stopTS };

          let limit = (request.query.limit)? request.query.limit : 0;
          let offset = (request.query.offset)? request.query.offset : 0;

          // console.log("query:", query);

          try {
            const results = await db.collection(eventsTable).find(query).sort( { ts: 1 } ).skip(offset).limit(limit).toArray()
            // console.log("results:", results);

            if (results.length > 0) {
              let mod_results = results.map(doc => _renameAndClearFields(doc));
              return h.response(mod_results).code(200);
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }
          } catch(err) {
             console.log(err)
             return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }
        } else {

          if(request.query.author) {
            if(Array.isArray(request.query.author)) {
              query.event_author  = { $in: request.query.author };
            } else {
              query.event_author  = request.query.author;
            }
          }

          if(request.query.value) {
            if(Array.isArray(request.query.value)) {

              let inList = [];
              let ninList = [];

              for( let value of request.query.value ) {
                if(value.startsWith("!")) {
                  ninList.push(value.substr(1));
                } else {
                  inList.push(value);
                }
              }

              if( inList.length > 0 && ninList.length > 0) {
                query.event_value  = { $in: inList, $nin: ninList };
              } else if (inList.length > 0) {
                query.event_value  = { $in: inList };
              } else {
                query.event_value  = { $nin: ninList };
              }

            } else {
              if(request.query.value.startsWith("!")) {
                query.event_value  = { $ne: request.query.value.substr(1) };
              } else {
                query.event_value  = request.query.value;
              }
            }
          }

          if(request.query.freetext) {

            query.event_free_text = { $regex: `${request.query.freetext}`};
          }

          //Time filtering
          if (request.query.startTS) {
            let tempStartTS = new Date(request.query.startTS);
            let startTS = (tempStartTS >= startTS && tempStartTS <= cruise.stopTS)? tempStartTS : cruise.startTS;
            query.ts = { $gte: startTS }
          }

          if (request.query.stopTS) {
            let tempStopTS = new Date(request.query.stopTS);
            let stopTS = (tempStopTS >= startTS && tempStopTS <= cruise.stopTS)? tempStopTS : cruise.stopTS;
            if(query.ts) {
              query.ts.$lte = stopTS
            } else { 
              query.ts = {"$lte": stopTS}
            }
          }

          let limit = (request.query.limit)? request.query.limit : 0;
          let offset = (request.query.offset)? request.query.offset : 0;

          // console.log("query:", query);

          try {
            const results = await db.collection(eventsTable).find(query).sort( { ts: 1  } ).skip(offset).limit(limit).toArray()
            // console.log("results:", results);

            if (results.length > 0) {

              let mod_results = results.map(doc => _renameAndClearFields(doc));

              if(request.query.format && request.query.format == "csv") {
                converter.json2csv(flattenJSON(mod_results), (err, csv) => {
                  if(err) {
                    throw err;
                  }
                  return h.response(csv).code(200);
                }, json2csvOptions);
              } else {
                return h.response(mod_results).code(200);
              }
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }
          } catch(err) {
             console.log(err)
             return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'read_events']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: Joi.object({
            id: Joi.string().length(24).required()
          }),
          query: Joi.object({
            format: Joi.string().optional(),
            offset: Joi.number().integer().min(0).optional(),
            limit: Joi.number().integer().min(1).optional(),
            author: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
            startTS: Joi.date().iso(),
            stopTS: Joi.date().iso(),
            datasource: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
            value: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
            freetext: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
          }).optional(),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            200: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.object({
                id: Joi.object(),
                event_author: Joi.string(),
                ts: Joi.date().iso(),
                event_value: Joi.string(),
                event_options: Joi.array().items(Joi.object({
                  event_option_name: Joi.string(),
                  event_option_value: Joi.string().allow('')
                })),
                event_free_text: Joi.string().allow(''),
              }))
            ),
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
        description: 'Return the events based on query parameters',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong>, <strong>event_logger</strong> or <strong>event_watcher</strong></p>',
        tags: ['events','auth', 'api'],
      }
    });

    server.route({
      method: 'GET',
      path: '/events/bylowering/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = {};
        let lowering = null;

        try {
          const loweringResult = await db.collection(loweringsTable).findOne({ _id: ObjectID(request.params.id) })

          if(!loweringResult) {
            return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
          }

          if(loweringResult.lowering_hidden && !request.auth.credentials.scope.includes("admin")) {
            return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve hidden lowerings"}).code(401);
          }

          lowering = loweringResult;

        } catch(err) {
           console.log(err)
           return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }

        //Data source filtering
        if (request.query.datasource) {

          let datasource_query = {};

          if(Array.isArray(request.query.datasource)) {
            datasource_query.data_source  = { $in: request.query.datasource };
          } else {
            datasource_query.data_source  = request.query.datasource;
          }

          try {

            const collection = await db.collection(eventAuxDataTable).find(datasource_query, {_id: 0, event_id: 1}).toArray()
            let eventIDs = collection.map(x => x.event_id);
            query._id = { $in: eventIDs};

          } catch(err) {
            console.log(err)
            return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }

          if(request.query.author) {
            if(Array.isArray(request.query.author)) {
              query.event_author  = { $in: request.query.author };
            } else {
              query.event_author  = request.query.author;
            }
          }

          if(request.query.value) {
            if(Array.isArray(request.query.value)) {

              let inList = [];
              let ninList = [];

              for( let value of request.query.value ) {
                if(value.startsWith("!")) {
                  ninList.push(value.substr(1));
                } else {
                  inList.push(value);
                }
              }
              
              if( inList.length > 0 && ninList.length > 0) {
                query.event_value  = { $in: inList, $nin: ninList };
              } else if (inList.length > 0) {
                query.event_value  = { $in: inList };
              } else {
                query.event_value  = { $nin: ninList };
              }

            } else {
              if(request.query.value.startsWith("!")) {
                query.event_value  = { $ne: request.query.value.substr(1) };
              } else {
                query.event_value  = request.query.value;
              }
            }
          }

          if(request.query.freetext) {
            query.event_free_text = { $regex: `${request.query.freetext}`};
          }

          //Time filtering
          if (request.query.startTS) {
            let tempStartTS = new Date(request.query.startTS);
            // console.log("tempStartTS:", tempStartTS);
            startTS = (tempStartTS >= lowering.startTS && tempStartTS <= lowering.stopTS)? tempStartTS : lowering.startTS;
            // console.log("startTS:", startTS);
          }

          if (request.query.stopTS) {
            let tempStopTS = new Date(request.query.stopTS);
            // console.log("tempStopTS:", tempStopTS);
            stopTS = (tempStopTS >= lowering.startTS && tempStopTS <= lowering.stopTS)? tempStopTS : lowering.stopTS;
            // console.log("stopTS:", stopTS);
          }

          query.ts = {"$gte": startTS , "$lte": stopTS };

          let limit = (request.query.limit)? request.query.limit : 0;
          let offset = (request.query.offset)? request.query.offset : 0;

            // console.log("query:", query);

          try {

            const results = await db.collection(eventsTable).find(query).sort( { ts: 1 } ).skip(offset).limit(limit).toArray()

            if (results.length > 0) {
              let mod_results = results.map(doc => _renameAndClearFields(doc));
              return h.response(results).code(200);
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }
          } catch(err) {
            console.log(err)
            return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }
        } else {

          if(request.query.author) {
            if(Array.isArray(request.query.author)) {
              query.event_author  = { $in: request.query.author };
            } else {
              query.event_author  = request.query.author;
            }
          }

          if(request.query.value) {
            if(Array.isArray(request.query.value)) {

              let inList = [];
              let ninList = [];

              for( let value of request.query.value ) {
                if(value.startsWith("!")) {
                  ninList.push(value.substr(1));
                } else {
                  inList.push(value);
                }
              }

              if( inList.length > 0 && ninList.length > 0) {
                query.event_value  = { $in: inList, $nin: ninList };
              } else if (inList.length > 0) {
                query.event_value  = { $in: inList };
              } else {
                query.event_value  = { $nin: ninList };
              }

            } else {
              if(request.query.value.startsWith("!")) {
                query.event_value  = { $ne: request.query.value.substr(1) };
              } else {
                query.event_value  = request.query.value;
              }
            }
          }

          if(request.query.freetext) {

            query.event_free_text = { $regex: `${request.query.freetext}`};
          }

          //Time filtering
          if (request.query.startTS) {
            let tempStartTS = new Date(request.query.startTS);
            let startTS = (tempStartTS >= startTS && tempStartTS <= lowering.stopTS)? tempStartTS : lowering.startTS;
            query.ts = { $gte: startTS }
          }

          if (request.query.stopTS) {
            let tempStopTS = new Date(request.query.stopTS);
            let stopTS = (tempStopTS >= startTS && tempStopTS <= lowering.stopTS)? tempStopTS : lowering.stopTS;
            if(query.ts) {
              query.ts.$lte = stopTS
            } else { 
              query.ts = {"$lte": stopTS}
            }
          }

          // query.ts = {"$gte": startTS , "$lte": stopTS };

          let limit = (request.query.limit)? request.query.limit : 0;
          let offset = (request.query.offset)? request.query.offset : 0;

          // console.log("query:", query);

          try {
            const results = await db.collection(eventsTable).find(query).sort( { ts: 1  } ).skip(offset).limit(limit).toArray()
            // console.log("results:", results);

            if (results.length > 0) {

              let mod_results = results.map(doc => _renameAndClearFields(doc));

              if(request.query.format && request.query.format == "csv") {
                converter.json2csv(flattenJSON(mod_results), (err, csv) => {
                  if(err) {
                    throw err;
                  }
                  return h.response(csv).code(200);
                }, json2csvOptions);
              } else {
                return h.response(mod_results).code(200);
              }
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }
          } catch(err) {
            console.log(err)
            return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'read_events']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: Joi.object({
            id: Joi.string().length(24).required()
          }),
          query: Joi.object({
            format: Joi.string().optional(),
            offset: Joi.number().integer().min(0).optional(),
            limit: Joi.number().integer().min(1).optional(),
            author: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
            startTS: Joi.date().iso(),
            stopTS: Joi.date().iso(),
            datasource: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
            value: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
            freetext: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
          }).optional(),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            200: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.object({
                id: Joi.object(),
                event_author: Joi.string(),
                ts: Joi.date().iso(),
                event_value: Joi.string(),
                event_options: Joi.array().items(Joi.object({
                  event_option_name: Joi.string(),
                  event_option_value: Joi.string().allow('')
                })),
                event_free_text: Joi.string().allow(''),
              }))
            ),
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
        description: 'Return the events based on query parameters',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong>, <strong>event_logger</strong> or <strong>event_watcher</strong></p>',
        tags: ['events','auth', 'api'],
      }
    });

    server.route({
      method: 'GET',
      path: '/events',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = {};

        // console.log(request.query);

        //Data source filtering
        if (request.query.datasource) {

          let datasource_query = {};

          if(Array.isArray(request.query.datasource)) {
            datasource_query.data_source  = { $in: request.query.datasource };
          } else {
            datasource_query.data_source  = request.query.datasource;
          }

          try {

            const collection = await db.collection(eventAuxDataTable).find(datasource_query, {_id: 0, event_id: 1}).toArray()

            let eventIDs = collection.map(x => x.event_id);

            // console.log("collection:", eventIDs);

            query._id = { $in: eventIDs};

          } catch(err) {
            console.log(err)
            return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }

          if(request.query.author) {
            if(Array.isArray(request.query.author)) {
              query.event_author  = { $in: request.query.author };
            } else {
              query.event_author  = request.query.author;
            }
          }

          if(request.query.value) {
            if(Array.isArray(request.query.value)) {

              let inList = [];
              let ninList = [];

              for( let value of request.query.value ) {
                if(value.startsWith("!")) {
                  ninList.push(value.substr(1));
                } else {
                  inList.push(value);
                }
              }
              
              if( inList.length > 0 && ninList.length > 0) {
                query.event_value  = { $in: inList, $nin: ninList };
              } else if (inList.length > 0) {
                query.event_value  = { $in: inList };
              } else {
                query.event_value  = { $nin: ninList };
              }

            } else {
              if(request.query.value.startsWith("!")) {
                query.event_value  = { $ne: request.query.value.substr(1) };
              } else {
                query.event_value  = request.query.value;
              }
            }
          }

          if(request.query.freetext) {

            query.event_free_text = { $regex: `${request.query.freetext}`};
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

            query.ts = {"$gte": startTS , "$lte": stopTS };
          }

          let limit = (request.query.limit)? request.query.limit : 0;
          let offset = (request.query.offset)? request.query.offset : 0;
          let sort = (request.query.sort === "newest")? { ts: -1 } : { ts: 1 };

          // console.log("query:", query);

          try {
            const results = await db.collection(eventsTable).find(query).sort(sort).skip(offset).limit(limit).toArray()
            // console.log("results:", results);

            if (results.length > 0) {
              results.forEach(_renameAndClearFields);
              return h.response(results).code(200);
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }
          } catch(err) {
            console.log(err)
            return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }

        } else {

          if(request.query.author) {
            if(Array.isArray(request.query.author)) {
              query.event_author  = { $in: request.query.author };
            } else {
              query.event_author  = request.query.author;
            }
          }

          if(request.query.value) {
            if(Array.isArray(request.query.value)) {

              let inList = [];
              let ninList = [];

              for( let value of request.query.value ) {
                if(value.startsWith("!")) {
                  ninList.push(value.substr(1));
                } else {
                  inList.push(value);
                }
              }

              if( inList.length > 0 && ninList.length > 0) {
                query.event_value  = { $in: inList, $nin: ninList };
              } else if (inList.length > 0) {
                query.event_value  = { $in: inList };
              } else {
                query.event_value  = { $nin: ninList };
              }

            } else {
              if(request.query.value.startsWith("!")) {
                query.event_value  = { $ne: request.query.value.substr(1) };
              } else {
                query.event_value  = request.query.value;
              }
            }
          }

          if(request.query.freetext) {

            query.event_free_text = { $regex: `${request.query.freetext}`};
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

            query.ts = {"$gte": startTS , "$lte": stopTS };
          }

          let limit = (request.query.limit)? request.query.limit : 0;
          let offset = (request.query.offset)? request.query.offset : 0;
          let sort = (request.query.sort === "newest")? { ts: -1 } : { ts: 1 };

          // console.log("query:", query);

          try {
            const results = await db.collection(eventsTable).find(query).sort(sort).skip(offset).limit(limit).toArray()
            // console.log("results:", results);

            if (results.length > 0) {

              let mod_results = results.map(doc => _renameAndClearFields(doc));

              if(request.query.format && request.query.format == "csv") {
                converter.json2csv(flattenJSON(mod_results), (err, csv) => {
                  if(err) {
                    throw err;
                  }
                  return h.response(csv).code(200);
                }, json2csvOptions);
              } else {
                return h.response(mod_results).code(200);
              }
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }
          } catch(err) {
            console.log(err)
            return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'read_events']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          query: Joi.object({
            format: Joi.string().optional(),
            offset: Joi.number().integer().min(0).optional(),
            limit: Joi.number().integer().min(1).optional(),
            sort: Joi.string().optional(),
            author: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
            startTS: Joi.date().iso(),
            stopTS: Joi.date().iso(),
            datasource: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
            value: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
            freetext: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ),
          }).optional(),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            200: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.object({
                id: Joi.object(),
                event_author: Joi.string(),
                ts: Joi.date().iso(),
                event_value: Joi.string(),
                event_options: Joi.array().items(Joi.object({
                  event_option_name: Joi.string(),
                  event_option_value: Joi.string().allow('')
                })),
                event_free_text: Joi.string().allow(''),
              }))
            ),
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
        description: 'Return the events based on query parameters',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong>, <strong>event_logger</strong> or <strong>event_watcher</strong></p>',
        tags: ['events','auth', 'api'],
      }
    });

    server.route({
      method: 'GET',
      path: '/events/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = { _id: ObjectID(request.params.id) };

        try {
          const result = await db.collection(eventsTable).findOne(query);

          if (!result) {
            return h.response({ "statusCode": 404, 'message': 'No record found for id: ' + request.params.id }).code(404);
          }

          let mod_result = _renameAndClearFields(result);
          return h.response(mod_result).code(200);
        } catch(err) {
          console.log(err)
          return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }
      },
      config: {
        auth:{
          strategy: 'jwt',
          scope: ['admin', 'read_events']
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
              event_author: Joi.string(),
              ts: Joi.date().iso(),
              event_value: Joi.string(),
              event_options: Joi.array().items(Joi.object({
                event_option_name: Joi.string(),
                event_option_value: Joi.string().allow('')
              })),
              event_free_text: Joi.string().allow(''),
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
        description: 'Return the events based on event id',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong>, <strong>event_logger</strong> or <strong>event_watcher</strong></p>',
        tags: ['events','auth','api'],
      }
    });

    server.route({
      method: 'POST',
      path: '/events',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let event = request.payload;

        if(event.id) {
          try {
            event._id = new ObjectID(event.id);
            delete event.id;
          } catch(err) {
            console.log("invalid ObjectID");
            return h.response({statusCode: 400, error: "Invalid argument", message: "id must be a single String of 12 bytes or a string of 24 hex characters"}).code(400);
          }

          const result = await db.collection(eventsTable).findOne({_id: event._id});
          if(result) {
            return h.response({statusCode:400, error: "duplicate", message: "duplicate event ID"}).code(400);
          }
        }

        if(!event.ts) {
          event.ts = new Date();
        }

        if(!event.event_options) {
          event.event_options = [];
        } else {
          event.event_options = event.event_options.map((event_option) => {
            event_option.event_option_name = event_option.event_option_name.toLowerCase().replace(/\s+/g, "_");
            return event_option;
          });
        }

        if(!event.event_free_text) {
          event.event_free_text = "";
        }

        if(event.event_author) {
          try {
            const result = await db.collection(usersTable).findOne({username: event.event_author})

            if (!result) {
              return h.response({ "statusCode": 401, 'error': 'invalid user', 'message': 'specified user does not exist'}).code(401);
            }

          } catch(err) {
            console.log(err)
            return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }
        } else {
          try {
            const result = await db.collection(usersTable).findOne({_id: new ObjectID(request.auth.credentials.id)})
            
            if (!result) {
              return h.response({ "statusCode": 401, 'error': 'invalid user', 'message': 'specified user does not exist'}).code(401);
            }

            event.event_author = result.username;

          } catch(err) {
            console.log(err)
            return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
          }
        }

        try {
          const result = await db.collection(eventsTable).insertOne(event)

            if (!result) {
              return h.response({ "statusCode": 400, 'message': 'Bad request'}).code(400);
            }

            let diff =(new Date().getTime() - event.ts.getTime()) / 1000;
            // console.log(diff);
            if(Math.abs(Math.round(diff)) < THRESHOLD) {
              event = _renameAndClearFields(event);
              server.publish('/ws/status/newEvents', event);
            }

            return h.response({ n: result.result.n, ok: result.result.ok, insertedCount: result.insertedCount, insertedId: result.insertedId }).code(201);
        } catch(err) {
          console.log(err)
          return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'write_events']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          payload: {
            id: Joi.string().length(24).optional(),
            event_author: Joi.string().min(1).max(100).optional(),
            ts: Joi.date().iso().optional(),
            event_value: Joi.string().min(1).max(100).required(),
            event_options: Joi.array().items(Joi.object({
              event_option_name:Joi.string().required(),
              event_option_value:Joi.string().allow('').required()
            })).optional(),
            event_free_text: Joi.string().allow('').optional()
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

        description: 'Create a new event',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong> or <strong>event_logger</strong></p>',
        tags: ['events','auth','api'],
      }
    });

    server.route({
      method: 'PATCH',
      path: '/events/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = {}

        try {
          query._id = new ObjectID(request.params.id);
        } catch(err) {
          console.log("invalid ObjectID");
          return h.response({statusCode: 400, error: "Invalid argument", message: "id must be a single String of 12 bytes or a string of 24 hex characters"}).code(400);
        }

        let event = null;
        try {
          const result = await db.collection(eventsTable).findOne(query);

          if(!result) {
            return h.response({ "statusCode": 400, "error": "Bad request", 'message': 'No record found for id: ' + request.params.id }).code(400);
          }

          event = result;

        } catch(err) {
          console.log(err)
          return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }

        if(request.payload.event_options) {

          request.payload.event_options = request.payload.event_options.map((event_option) => {
            event_option.event_option_name = event_option.event_option_name.toLowerCase().replace(/\s+/g, "_");
            return event_option;
          });

          request.payload.event_options.forEach((requestOption) => {
            let foundit = false;
            event.event_options.forEach((event_option) => {
              if(event_option.event_option_name == requestOption.event_option_name) {
                event_option.event_option_value = requestOption.event_option_value;
                foundit = true;
              }
            });

            if (!foundit) {
              event.event_options.push(requestOption);
            }
          });
        }

        try {

          const result = await db.collection(eventsTable).findOneAndUpdate(query, { $set: request.payload },{returnOriginal: false})

          let event = _renameAndClearFields(result.value);
          server.publish('/ws/status/updateEvents', event);

          return h.response(JSON.stringify(result.lastErrorObject)).code(204);

        } catch(err) {
          console.log(err)
          return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'write_events']
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: Joi.object({
            id: Joi.string().length(24).required()
          }),
          payload: Joi.object({
            event_author: Joi.string().min(1).max(100).optional(),
            ts: Joi.date().iso().optional(),
            event_value: Joi.string().min(1).max(100).optional(),
            event_options: Joi.array().items(Joi.object({
              event_option_name:Joi.string().required(),
              event_option_value:Joi.string().allow('').required()
            })).optional(),
            event_free_text: Joi.string().allow('').optional()
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
        description: 'Update a event record',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong> or <strong>event_logger</strong></p>',
        tags: ['events','auth','api'],
      }
    });

    server.route({
      method: 'DELETE',
      path: '/events/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let query = {}

        try {
          query._id = new ObjectID(request.params.id);
        } catch(err) {
          console.log("invalid ObjectID");
          return h.response({statusCode: 400, error: "Invalid argument", message: "id must be a single String of 12 bytes or a string of 24 hex characters"}).code(400);
        }

        let event = null;

        try {
          const result = await db.collection(eventsTable).findOne(query)

          if(!result) {
            return h.response({ "statusCode": 404, 'message': 'No record found for id: ' + request.params.id }).code(404);
          }

          event = result;

        } catch(err) {
          console.log(err)
          return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }
  
        try {
          const aux_data_result = await db.collection(eventAuxDataTable).find({ event_id: new ObjectID(request.params.id) }).toArray()

          event.aux_data = aux_data_result;
        } catch(err) {
          console.log(err)
          return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }
  
        try {
          const result = await db.collection(eventsTable).findOneAndDelete(query)
        } catch(err) {
          console.log(err)
          return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }

        try {
          const result = await db.collection(eventAuxDataTable).deleteMany({ event_id: new ObjectID(request.params.id) })
        } catch(err) {
          console.log(err)
          return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }

        _renameAndClearFields(event);
        server.publish('/ws/status/deleteEvents', event);

        return h.response(event).code(204);
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'write_events']
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
        description: 'Delete an events record',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong> or <strong>event_logger</strong></p>',
        tags: [ 'events','auth','api'],
      }
    });

    server.route({
      method: 'DELETE',
      path: '/events/all',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        // let query = {};

        try {
          const result = await db.collection(eventsTable).deleteMany()
        } catch(err) {
          console.log(err)
          return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
        }
  
        try {
          const result = await db.collection(eventAuxDataTable).deleteMany()
          return h.response(result).code(204);
        } catch(err) {
          console.log(err)
          return h.response({statusCode: 503, error: "database error", message: "unknown error" }).code(503)
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
        description: 'Delete ALL the event records',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong> or <strong>event_logger</strong></p>',
        tags: [ 'events','auth','api'],
      }
    });
  }
};

