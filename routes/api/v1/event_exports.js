'use strict';

const Joi = require('joi');
const converter = require('json-2-csv');
const extend = require('jquery-extend');

const json2csvOptions = {
  checkSchemaDifferences: false,
  emptyFieldValue: ''
};

const {
  eventsTable,
  eventAuxDataTable,
  loweringsTable,
  cruisesTable
} = require('../../../config/db_constants');

function flattenJSON(json) {
  // console.log("Pre-Export:", this.props.event_export.events)
  let exportData = json.map((event) => {
    let copiedEvent = extend(true, {}, event);
    if(copiedEvent.aux_data) {
      copiedEvent.aux_data.map((data) => {
        data.data_array.map((data2) => {

          let elementName = `${data.data_source}_${data2.data_name}_value`;
          let elementUOM = `${data.data_source}_${data2.data_name}_uom`;
          // console.log(elementName, data2.data_value, elementUOM, data2.data_uom)
          copiedEvent[elementName] = data2.data_value;
          copiedEvent[elementUOM] = data2.data_uom;
        });  
      });
      delete copiedEvent.aux_data;
    }

    copiedEvent.event_options.map((data) => {
      let elementName = `event_option_${data.event_option_name}`;
      // console.log(elementName, data.event_option_value)
      copiedEvent[elementName] = data.event_option_value;
    });

    delete copiedEvent.event_options;

    copiedEvent.ts = copiedEvent.ts.toISOString();
    copiedEvent.id = copiedEvent.id.toString();
    copiedEvent.event_free_text = "\"" + copiedEvent.event_free_text.replace(/"/g, '\\"') + "\"";
    return copiedEvent;

  });

  return exportData;

}

const _renameAndClearFields = (doc) => {

  //rename id
  doc.id = doc._id;
  delete doc._id;
  delete doc.event_id;

  if(doc.aux_data && doc.aux_data.length > 0) {
    doc.aux_data.forEach(_renameAndClearFields);
  }

  return doc;
};

exports.plugin = {
  name: 'routes-api-event-exports',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    server.route({
      method: 'GET',
      path: '/event_exports/bycruise/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let cruise = null
      
        try {
          const cruiseResult = await db.collection(cruisesTable).findOne({ _id: ObjectID(request.params.id) })

          if(!cruise) {
            return h.response({ "statusCode": 404, "message": "cruise not found for that id"}).code(404);          
          }

          cruise = cruiseResult;

        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
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

          let eventIDs = []
          try {

            const collection = await db.collection(eventAuxDataTable).find(datasource_query, {_id: 0, event_id: 1}).toArray()

            eventIDs = collection.map(x => x.event_id);

          } catch (err) {
            console.log("ERROR:", err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
          }
            // console.log("collection:", eventIDs);

          query._id = { $in: eventIDs};

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
            startTS = (tempStartTS >= startTS && tempStartTS <= stopTS)? tempStartTS : startTS;
            // console.log("startTS:", startTS);
          }

          if (request.query.stopTS) {
            let tempStopTS = new Date(request.query.stopTS);
            // console.log("tempStopTS:", tempStopTS);
            stopTS = (tempStopTS >= startTS && tempStopTS <= stopTS)? tempStopTS : stopTS;
            // console.log("stopTS:", stopTS);
          }

          query.ts = {"$gte": startTS , "$lte": stopTS };

          let offset = (request.query.offset)? request.query.offset : 0;

          let lookup = {
            from: eventAuxDataTable,
            localField: "_id",
            foreignField: "event_id",
            as: "aux_data"
          };

          let aggregate = [];
          aggregate.push({ $lookup: lookup });
          aggregate.push({ $match: query});
          aggregate.push({ $sort : { ts : 1 }});

          if(request.query.limit) { 
            aggregate.push({ $limit: request.query.limit});
          }
          // console.log("aggregate:", aggregate);
          try {
            const results = await db.collection(eventsTable).aggregate(aggregate).skip(offset).toArray()

            if (results.length > 0) {
              results.forEach(_renameAndClearFields);
              return h.response(results).code(200);
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }            
          } catch(err) {
            console.log(err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
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
            // console.log("tempStartTS:", tempStartTS);
            startTS = (tempStartTS >= startTS && tempStartTS <= stopTS)? tempStartTS : startTS;
            // console.log("startTS:", startTS);
          }

          if (request.query.stopTS) {
            let tempStopTS = new Date(request.query.stopTS);
            // console.log("tempStopTS:", tempStopTS);
            stopTS = (tempStopTS >= startTS && tempStopTS <= stopTS)? tempStopTS : stopTS;
            // console.log("stopTS:", stopTS);
          }

          query.ts = {"$gte": startTS , "$lte": stopTS };

          let offset = (request.query.offset)? request.query.offset : 0;

          let lookup = {
            from: eventAuxDataTable,
            localField: "_id",
            foreignField: "event_id",
            as: "aux_data"
          };

          let aggregate = [];
          aggregate.push({ $lookup: lookup });
          aggregate.push({ $match: query});
          aggregate.push({ $sort : { ts : 1 }});

          if(request.query.limit) {
            aggregate.push({ $limit: request.query.limit});
          }

          // console.log("aggregate:", aggregate);

          try {
            const results = await db.collection(eventsTable).aggregate(aggregate).skip(offset).toArray()

            if (results.length > 0) {
              results.forEach(_renameAndClearFields);

              if(request.query.format && request.query.format == "csv") {
                converter.json2csv(flattenJSON(results), (err, csv) => {
                  if(err) {
                    throw err;
                  }
                  return h.response(csv).code(200);
                }, json2csvOptions);
              } else {
                return h.response(results).code(200);
              }
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }
          } catch(err) {
            console.log(err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
          };
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
            ).optional(),
            startTS: Joi.date().optional(),
            stopTS: Joi.date().optional(),
            datasource: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ).optional(),
            value: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ).optional(),
            freetext: Joi.string().optional(),
          }).optional(),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            200: Joi.any(),
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
        description: 'Export events merged with their aux_data based on the query parameters',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong>, <strong>event_logger</strong> or <strong>event_watcher</strong></p>',
        tags: ['events','auth','api'],
      }
    });

    server.route({
      method: 'GET',
      path: '/event_exports/bylowering/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;
      
        let lowering = null
      
        try {
          const loweringResult = await db.collection(loweringsTable).findOne({ _id: ObjectID(request.params.id) })

          if(!lowering) {
            return h.response({ "statusCode": 404, "message": "lowering not found for that id"}).code(404);          
          }

          lowering = loweringResult;

        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }

        if(lowering.lowering_hidden && !request.auth.credentials.scope.includes("admin")) {
          return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve hidden lowerings"}).code(401);
        }

        let query = {};
        let startTS = new Date(lowering.start_ts);
        let stopTS = new Date(lowering.stop_ts);

        // console.log(request.query);

        //Data source filtering
        if (request.query.datasource) {

          let datasource_query = {};

          if(Array.isArray(request.query.datasource)) {
            datasource_query.data_source  = { $in: request.query.datasource };
          } else {
            datasource_query.data_source  = request.query.datasource;
          }

          let eventIDs = [];
          try {
            const collection = await db.collection(eventAuxDataTable).find(datasource_query, {_id: 0, event_id: 1}).toArray()
            eventIDs = collection.map(x => x.event_id);

          } catch(err) {
            console.log(err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
          }

          // console.log("collection:", eventIDs);

          query._id = { $in: eventIDs};

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
            startTS = (tempStartTS >= startTS && tempStartTS <= stopTS)? tempStartTS : startTS;
            // console.log("startTS:", startTS);
          }

          if (request.query.stopTS) {
            let tempStopTS = new Date(request.query.stopTS);
            // console.log("tempStopTS:", tempStopTS);
            stopTS = (tempStopTS >= startTS && tempStopTS <= stopTS)? tempStopTS : stopTS;
            // console.log("stopTS:", stopTS);
          }

          query.ts = {"$gte": startTS , "$lte": stopTS };

          let offset = (request.query.offset)? request.query.offset : 0;

          let lookup = {
            from: eventAuxDataTable,
            localField: "_id",
            foreignField: "event_id",
            as: "aux_data"
          };

          let aggregate = [];
          aggregate.push({ $lookup: lookup });
          aggregate.push({ $match: query});
          aggregate.push({ $sort : { ts : 1 }});

          if(request.query.limit) { 
            aggregate.push({ $limit: request.query.limit});
          }

          // console.log("query:", query);
          // console.log("aggregate:", aggregate);

          try {
            const results = await db.collection(eventsTable).aggregate(aggregate).skip(offset).toArray()

            if (results.length > 0) {
              results.forEach(_renameAndClearFields);
              return h.response(results).code(200);
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }
          } catch(err) {
            console.log(err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
          };
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
            // console.log("tempStartTS:", tempStartTS);
            startTS = (tempStartTS >= startTS && tempStartTS <= stopTS)? tempStartTS : startTS;
            // console.log("startTS:", startTS);
          }

          if (request.query.stopTS) {
            let tempStopTS = new Date(request.query.stopTS);
            // console.log("tempStopTS:", tempStopTS);
            stopTS = (tempStopTS >= startTS && tempStopTS <= stopTS)? tempStopTS : stopTS;
            // console.log("stopTS:", stopTS);
          }

          query.ts = {"$gte": startTS , "$lte": stopTS };

          let offset = (request.query.offset)? request.query.offset : 0;

          let lookup = {
            from: eventAuxDataTable,
            localField: "_id",
            foreignField: "event_id",
            as: "aux_data"
          };

          let aggregate = [];
          aggregate.push({ $lookup: lookup });
          aggregate.push({ $match: query});
          aggregate.push({ $sort : { ts : 1 }});

          if(request.query.limit) {
            aggregate.push({ $limit: request.query.limit});
          }

          // console.log("query:", query);
          // console.log("aggregate:", aggregate);

          try {
            const results = await db.collection(eventsTable).aggregate(aggregate).skip(offset).toArray()

            if (results.length > 0) {
              results.forEach(_renameAndClearFields);

              if(request.query.format && request.query.format == "csv") {
                converter.json2csv(flattenJSON(results), (err, csv) => {
                  if(err) {
                    throw err;
                  }
                  return h.response(csv).code(200);
                }, json2csvOptions);
              } else {
                return h.response(results).code(200);
              }
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }
          } catch(err) {
            console.log(err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
          };
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
            ).optional(),
            startTS: Joi.date().optional(),
            stopTS: Joi.date().optional(),
            datasource: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ).optional(),
            value: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ).optional(),
            freetext: Joi.string().optional(),
          }).optional(),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            200: Joi.any(),
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
        description: 'Export events merged with their aux_data based on the query parameters',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong>, <strong>event_logger</strong> or <strong>event_watcher</strong></p>',
        tags: ['events','auth','api'],
      }
    });

    server.route({
      method: 'GET',
      path: '/event_exports',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;
      
        let query = {};

        //Data source filtering
        if (request.query.datasource) {

          let datasource_query = {};

          if(Array.isArray(request.query.datasource)) {
            datasource_query.data_source  = { $in: request.query.datasource };
          } else {
            datasource_query.data_source  = request.query.datasource;
          }

          let eventIDs = []

          try {
            const collection = await db.collection(eventAuxDataTable).find(datasource_query, {_id: 0, event_id: 1}).toArray()
            eventIDs = collection.map(x => x.event_id);
          } catch(err) {
            console.log(err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
          };

          query._id = { $in: eventIDs};

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

          let offset = (request.query.offset)? request.query.offset : 0;

          let lookup = {
            from: eventAuxDataTable,
            localField: "_id",
            foreignField: "event_id",
            as: "aux_data"
          };

          let aggregate = [];
          aggregate.push({ $lookup: lookup });
          aggregate.push({ $match: query});
          aggregate.push({ $sort : { ts : 1 }});

          if(request.query.limit) { 
            aggregate.push({ $limit: request.query.limit});
          }

            // console.log("aggregate:", aggregate);
          try {
            const results = await db.collection(eventsTable).aggregate(aggregate).skip(offset).toArray()

              if (results.length > 0) {
                results.forEach(_renameAndClearFields);
                return h.response(results).code(200);
              } else {
                return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
              }
          } catch(err) {
            console.log(err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
          };
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

          let offset = (request.query.offset)? request.query.offset : 0;

          let lookup = {
            from: eventAuxDataTable,
            localField: "_id",
            foreignField: "event_id",
            as: "aux_data"
          };

          let aggregate = [];
          aggregate.push({ $lookup: lookup });
          aggregate.push({ $match: query});
          aggregate.push({ $sort : { ts : 1 }});

          if(request.query.limit) {
            aggregate.push({ $limit: request.query.limit});
          }

          // console.log("aggregate:", aggregate);

          try {
            const results = await db.collection(eventsTable).aggregate(aggregate).skip(offset).toArray()

            if (results.length > 0) {
              results.forEach(_renameAndClearFields);

              if(request.query.format && request.query.format == "csv") {
                converter.json2csv(flattenJSON(results), (err, csv) => {
                  if(err) {
                    throw err;
                  }
                  return h.response(csv).code(200);
                }, json2csvOptions);
              } else {
                return h.response(results).code(200);
              }
            } else {
              return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
            }
          } catch(err) {
            console.log(err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
          };
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
            author: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ).optional(),
            startTS: Joi.date().optional(),
            stopTS: Joi.date().optional(),
            datasource: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ).optional(),
            value: Joi.alternatives().try(
              Joi.string(),
              Joi.array().items(Joi.string()).optional()
            ).optional(),
            freetext: Joi.string().optional(),
          }).optional(),
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            200: Joi.any(),
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
        description: 'Export events merged with their aux_data based on the query parameters',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong>, <strong>event_logger</strong> or <strong>event_watcher</strong></p>',
        tags: ['events','auth','api'],
      }
    });

    server.route({
      method: 'GET',
      path: '/event_exports/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;
      
        let query = { _id: new ObjectID(request.params.id)};

        let lookup = {
          from: eventAuxDataTable,
          localField: "_id",
          foreignField: "event_id",
          as: "aux_data"
        };

        let aggregate = [];
        aggregate.push({ $lookup: lookup });
        aggregate.push({ $match: query});

        // console.log(aggregate)

        try {
          const results = await db.collection(eventsTable).aggregate(aggregate).toArray()

          if (results.length > 0) {
            results.forEach(_renameAndClearFields);
            return h.response(results[0]).code(200);
          } else {
            return h.response({ "statusCode": 404, 'message': 'No records found'}).code(404);
          }
        } catch(err) {
          console.log(err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        };
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
              aux_data: Joi.array().items(Joi.object({
                id: Joi.object(),
                data_source: Joi.string(),
                data_array: Joi.array().items(Joi.object({
                  data_name: Joi.string(),
                  data_value: Joi.string(),
                  data_uom: Joi.string()
                }))
              }))
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
        description: 'Export an event merged with its aux_data based on event id',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong>, <strong>event_logger</strong> or <strong>event_watcher</strong></p>',
        tags: ['events','auth','api'],
      }
    });
  }
};