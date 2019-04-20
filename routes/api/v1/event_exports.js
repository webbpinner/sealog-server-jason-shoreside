const Joi = require('joi');
const Converter = require('json-2-csv');
const Extend = require('jquery-extend');

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

const _flattenJSON = (json) => {

  const exportData = json.map((event) => {

    const copiedEvent = Extend(true, {}, event);
    if (copiedEvent.aux_data) {
      copiedEvent.aux_data.map((data) => {
    
        data.data_array.map((data2) => {

          const elementName = `${data.data_source}_${data2.data_name}_value`;
          const elementUOM = `${data.data_source}_${data2.data_name}_uom`;
          copiedEvent[elementName] = data2.data_value;
          copiedEvent[elementUOM] = data2.data_uom;
        });  
      });
      delete copiedEvent.aux_data;
    }

    copiedEvent.event_options.map((data) => {

      const elementName = `event_option_${data.event_option_name}`;
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
};

const _renameAndClearFields = (doc) => {

  //rename id
  doc.id = doc._id;
  delete doc._id;
  delete doc.event_id;

  if (doc.aux_data && doc.aux_data.length > 0) {
    doc.aux_data.forEach(_renameAndClearFields);
  }

  return doc;
};

exports.plugin = {
  name: 'routes-api-event-exports',
  dependencies: ['hapi-mongodb'],
  register: (server, options) => {

    server.route({
      method: 'GET',
      path: '/event_exports/bycruise/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let cruise = null;
      
        try {
          const cruiseResult = await db.collection(cruisesTable).findOne({ _id: ObjectID(request.params.id) });

          if (!cruiseResult) {
            return h.response({ "statusCode": 404, "message": "cruise not found for that id" }).code(404);          
          }

          if (!request.auth.credentials.scope.includes('admin')) {
            // if (cruiseResult.cruise_hidden || !cruiseResult.cruise_access_list.includes(request.auth.credentials.id)) {
            if (cruiseResult.cruise_hidden) {
              return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve this cruise" }).code(401);
            }
          }

          cruise = cruiseResult;

        }
        catch (err) {
          console.log("ERROR:", err);
          return h.response({ statusCode: 503, error: "server error", message: "database error" }).code(503);
        }

        if (cruise.cruise_hidden && !request.auth.credentials.scope.includes("admin")) {
          return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve hidden cruises" }).code(401);
        }

        const query = {};

        if (request.query.author) {
          if (Array.isArray(request.query.author)) {
            query.event_author  = { $in: request.query.author };
          }
          else {
            query.event_author  = request.query.author;
          }
        }

        if (request.query.value) {
          if (Array.isArray(request.query.value)) {

            const inList = [];
            const ninList = [];

            for ( const value of request.query.value ) {
              if (value.startsWith("!")) {
                ninList.push(value.substr(1));
              }
              else {
                inList.push(value);
              }
            }
            
            if ( inList.length > 0 && ninList.length > 0) {
              query.event_value  = { $in: inList, $nin: ninList };
            }
            else if (inList.length > 0) {
              query.event_value  = { $in: inList };
            }
            else {
              query.event_value  = { $nin: ninList };
            }

          }
          else {
            if (request.query.value.startsWith("!")) {
              query.event_value  = { $ne: request.query.value.substr(1) };
            }
            else {
              query.event_value  = request.query.value;
            }
          }
        }

        if (request.query.freetext) {

          query.event_free_text = { $regex: `${request.query.freetext}` };
        }

        //Time filtering
        if (request.query.startTS) {
          const tempStartTS = new Date(request.query.startTS);
          const startTS = (tempStartTS >= cruise.start_ts && tempStartTS <= cruise.stop_ts) ? tempStartTS : cruise.start_ts;
          query.ts = { $gte: startTS };
        }
        else {
          query.ts = { $gte: cruise.start_ts };
        }

        if (request.query.stopTS) {
          const tempStopTS = new Date(request.query.stopTS);
          const stopTS = (tempStopTS >= cruise.start_ts && tempStopTS <= cruise.stop_ts) ? tempStopTS : cruise.stop_ts;
          query.ts.$lte = stopTS;
        }
        else {
          query.ts.$lte = cruise.stop_ts;
        }

        const offset = (request.query.offset) ? request.query.offset : 0;

        const lookup = {
          from: eventAuxDataTable,
          localField: "_id",
          foreignField: "event_id",
          as: "aux_data"
        };

        const aggregate = [];
        aggregate.push({ $match: query });
        aggregate.push({ $lookup: lookup });
        aggregate.push({ $sort : { ts : 1 } });

        if (request.query.limit) {
          aggregate.push({ $limit: request.query.limit });
        }

        // console.log("aggregate:", aggregate);
        let results = []

        try {
          results = await db.collection(eventsTable).aggregate(aggregate).skip(offset).toArray();
        }
        catch (err) {
          console.log(err);
          return h.response({ statusCode: 503, error: "server error", message: "database error" }).code(503);
        }

        if (results.length > 0) {

          // datasource filtering
          if (request.query.datasource) {

            const datasource_query = {};

            const eventIDs = results.map((event) => event._id);

            datasource_query.event_id = { $in: eventIDs };

            if (Array.isArray(request.query.datasource)) {
              datasource_query.data_source  = { $in: request.query.datasource };
            }
            else {
              datasource_query.data_source  = request.query.datasource;
            }

            let aux_data_results = []
            try {
              aux_data_results = await db.collection(eventAuxDataTable).find(datasource_query, { _id: 0, event_id: 1 }).toArray();
            }
            catch (err) {
              console.log(err);
              return h.response({ statusCode: 503, error: "database error", message: "unknown error" }).code(503);
            }

            const aux_data_eventID_set = new Set(aux_data_results.map(aux_data => String(aux_data.event_id)))

            results = results.filter((event) => {
              return (aux_data_eventID_set.has(String(event._id)))? event : null
            })

          }

          results.forEach(_renameAndClearFields);

          if (request.query.format && request.query.format === "csv") {

            const csv_results = await Converter.json2csvAsync(_flattenJSON(results), json2csvOptions)
              .then((csv) => {
          
                return csv;
              })
              .catch((err) => {
          
                console.log(err);
                throw err;    
              });

            return h.response(csv_results).code(200);
          }
          return h.response(results).code(200);
        }
        return h.response({ "statusCode": 404, 'message': 'No records found' }).code(404);
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
            freetext: Joi.string().optional()
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
        description: 'Export the events merged with their event_aux_data records for a cruise based on the cruise id',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong>, <strong>event_logger</strong> or <strong>event_watcher</strong></p>',
        tags: ['events','auth','api']
      }
    });

    server.route({
      method: 'GET',
      path: '/event_exports/bylowering/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let lowering = null;
      
        try {
          const loweringResult = await db.collection(loweringsTable).findOne({ _id: ObjectID(request.params.id) });

          if (!loweringResult) {
            return h.response({ "statusCode": 404, "message": "lowering not found for that id" }).code(404);          
          }

          if (!request.auth.credentials.scope.includes('admin')) {
            // if (loweringResult.lowering_hidden || !loweringResult.lowering_access_list.includes(request.auth.credentials.id)) {
            if (loweringResult.lowering_hidden) {
              return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve this lowering" }).code(401);
            }
          }

          lowering = loweringResult;

        }
        catch (err) {
          console.log("ERROR:", err);
          return h.response({ statusCode: 503, error: "server error", message: "database error" }).code(503);
        }

        if (lowering.lowering_hidden && !request.auth.credentials.scope.includes("admin")) {
          return h.response({ "statusCode": 401, "error": "not authorized", "message": "User not authorized to retrieve hidden lowerings" }).code(401);
        }

        const query = {};

        if (request.query.author) {
          if (Array.isArray(request.query.author)) {
            query.event_author  = { $in: request.query.author };
          }
          else {
            query.event_author  = request.query.author;
          }
        }

        if (request.query.value) {
          if (Array.isArray(request.query.value)) {

            const inList = [];
            const ninList = [];

            for ( const value of request.query.value ) {
              if (value.startsWith("!")) {
                ninList.push(value.substr(1));
              }
              else {
                inList.push(value);
              }
            }
            
            if ( inList.length > 0 && ninList.length > 0) {
              query.event_value  = { $in: inList, $nin: ninList };
            }
            else if (inList.length > 0) {
              query.event_value  = { $in: inList };
            }
            else {
              query.event_value  = { $nin: ninList };
            }

          }
          else {
            if (request.query.value.startsWith("!")) {
              query.event_value  = { $ne: request.query.value.substr(1) };
            }
            else {
              query.event_value  = request.query.value;
            }
          }
        }

        if (request.query.freetext) {

          query.event_free_text = { $regex: `${request.query.freetext}` };
        }

        //Time filtering
        if (request.query.startTS) {
          const tempStartTS = new Date(request.query.startTS);
          const startTS = (tempStartTS >= lowering.start_ts && tempStartTS <= lowering.stop_ts) ? tempStartTS : lowering.start_ts;
          query.ts = { $gte: startTS };
        }
        else {
          query.ts = { $gte: lowering.start_ts };
        }

        if (request.query.stopTS) {
          const tempStopTS = new Date(request.query.stopTS);
          const stopTS = (tempStopTS >= lowering.start_ts && tempStopTS <= lowering.stop_ts) ? tempStopTS : lowering.stop_ts;
          query.ts.$lte = stopTS;
        }
        else {
          query.ts.$lte = lowering.stop_ts;
        }

        const offset = (request.query.offset) ? request.query.offset : 0;

        const lookup = {
          from: eventAuxDataTable,
          localField: "_id",
          foreignField: "event_id",
          as: "aux_data"
        };

        const aggregate = [];
        aggregate.push({ $match: query });
        aggregate.push({ $lookup: lookup });
        aggregate.push({ $sort : { ts : 1 } });

        if (request.query.limit) {
          aggregate.push({ $limit: request.query.limit });
        }

        // console.log("aggregate:", aggregate);
        let results = []

        try {
          results = await db.collection(eventsTable).aggregate(aggregate).skip(offset).toArray();
        }
        catch (err) {
          console.log(err);
          return h.response({ statusCode: 503, error: "server error", message: "database error" }).code(503);
        }

        if (results.length > 0) {

          // datasource filtering
          if (request.query.datasource) {

            const datasource_query = {};

            const eventIDs = results.map((event) => event._id);

            datasource_query.event_id = { $in: eventIDs };

            if (Array.isArray(request.query.datasource)) {
              datasource_query.data_source  = { $in: request.query.datasource };
            }
            else {
              datasource_query.data_source  = request.query.datasource;
            }

            let aux_data_results = []
            try {
              aux_data_results = await db.collection(eventAuxDataTable).find(datasource_query, { _id: 0, event_id: 1 }).toArray();
            }
            catch (err) {
              console.log(err);
              return h.response({ statusCode: 503, error: "database error", message: "unknown error" }).code(503);
            }

            const aux_data_eventID_set = new Set(aux_data_results.map(aux_data => String(aux_data.event_id)))

            results = results.filter((event) => {
              return (aux_data_eventID_set.has(String(event._id)))? event : null
            })

          }

          results.forEach(_renameAndClearFields);

          if (request.query.format && request.query.format === "csv") {

            const csv_results = await Converter.json2csvAsync(_flattenJSON(results), json2csvOptions)
              .then((csv) => {
          
                return csv;
              })
              .catch((err) => {
          
                console.log(err);
                throw err;    
              });

            return h.response(csv_results).code(200);
          }
          return h.response(results).code(200);
        }
        return h.response({ "statusCode": 404, 'message': 'No records found' }).code(404);
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
            freetext: Joi.string().optional()
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
        description: 'Export the events merged with their event_aux_data records for a lowering based on the lowering id',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>admin</strong>, <strong>event_manager</strong>, <strong>event_logger</strong> or <strong>event_watcher</strong></p>',
        tags: ['events','auth','api']
      }
    });

    server.route({
      method: 'GET',
      path: '/event_exports',
      async handler(request, h) {

        const db = request.mongo.db;
        // const ObjectID = request.mongo.ObjectID;
      
        const query = {};

        //Data source filtering
        if (request.query.datasource) {

          const datasource_query = {};

          if (Array.isArray(request.query.datasource)) {
            datasource_query.data_source  = { $in: request.query.datasource };
          }
          else {
            datasource_query.data_source  = request.query.datasource;
          }

          let eventIDs = [];

          try {
            const collection = await db.collection(eventAuxDataTable).find(datasource_query, { _id: 0, event_id: 1 }).toArray();
            eventIDs = collection.map((x) => x.event_id);
          }
          catch (err) {
            console.log(err);
            return h.response({ statusCode: 503, error: "server error", message: "database error" }).code(503);
          }

          query._id = { $in: eventIDs };

          if (request.query.author) {
            if (Array.isArray(request.query.author)) {
              query.event_author  = { $in: request.query.author };
            }
            else {
              query.event_author  = request.query.author;
            }
          }

          if (request.query.value) {
            if (Array.isArray(request.query.value)) {

              const inList = [];
              const ninList = [];

              for ( const value of request.query.value ) {
                if (value.startsWith("!")) {
                  ninList.push(value.substr(1));
                }
                else {
                  inList.push(value);
                }
              }
              
              if ( inList.length > 0 && ninList.length > 0) {
                query.event_value  = { $in: inList, $nin: ninList };
              }
              else if (inList.length > 0) {
                query.event_value  = { $in: inList };
              }
              else {
                query.event_value  = { $nin: ninList };
              }

            }
            else {
              if (request.query.value.startsWith("!")) {
                query.event_value  = { $ne: request.query.value.substr(1) };
              }
              else {
                query.event_value  = request.query.value;
              }
            }
          }

          if (request.query.freetext) {

            query.event_free_text = { $regex: `${request.query.freetext}` };
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

            query.ts = { "$gte": startTS , "$lte": stopTS };
          }

          const offset = (request.query.offset) ? request.query.offset : 0;

          const lookup = {
            from: eventAuxDataTable,
            localField: "_id",
            foreignField: "event_id",
            as: "aux_data"
          };

          const aggregate = [];
          aggregate.push({ $match: query });
          aggregate.push({ $lookup: lookup });
          aggregate.push({ $sort : { ts : 1 } });

          if (request.query.limit) { 
            aggregate.push({ $limit: request.query.limit });
          }

          try {
            const results = await db.collection(eventsTable).aggregate(aggregate).skip(offset).toArray();

            if (results.length > 0) {
              results.forEach(_renameAndClearFields);
              return h.response(results).code(200);
            }
 
            return h.response({ "statusCode": 404, 'message': 'No records found' }).code(404);
            
          }
          catch (err) {
            console.log(err);
            return h.response({ statusCode: 503, error: "server error", message: "database error" }).code(503);
          }
        }
        else {

          if (request.query.author) {
            if (Array.isArray(request.query.author)) {
              query.event_author  = { $in: request.query.author };
            }
            else {
              query.event_author  = request.query.author;
            }
          }

          if (request.query.value) {
            if (Array.isArray(request.query.value)) {

              const inList = [];
              const ninList = [];

              for ( const value of request.query.value ) {
                if (value.startsWith("!")) {
                  ninList.push(value.substr(1));
                }
                else {
                  inList.push(value);
                }
              }
              
              if ( inList.length > 0 && ninList.length > 0) {
                query.event_value  = { $in: inList, $nin: ninList };
              }
              else if (inList.length > 0) {
                query.event_value  = { $in: inList };
              }
              else {
                query.event_value  = { $nin: ninList };
              }

            }
            else {
              if (request.query.value.startsWith("!")) {
                query.event_value  = { $ne: request.query.value.substr(1) };
              }
              else {
                query.event_value  = request.query.value;
              }
            }
          }

          if (request.query.freetext) {

            query.event_free_text = { $regex: `${request.query.freetext}` };
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

            query.ts = { "$gte": startTS , "$lte": stopTS };
          }

          const offset = (request.query.offset) ? request.query.offset : 0;

          const lookup = {
            from: eventAuxDataTable,
            localField: "_id",
            foreignField: "event_id",
            as: "aux_data"
          };

          const aggregate = [];
          aggregate.push({ $match: query });
          aggregate.push({ $lookup: lookup });
          aggregate.push({ $sort : { ts : 1 } });

          if (request.query.limit) {
            aggregate.push({ $limit: request.query.limit });
          }

          // console.log("aggregate:", aggregate);

          try {
            const results = await db.collection(eventsTable).aggregate(aggregate).skip(offset).toArray();

            if (results.length > 0) {
              results.forEach(_renameAndClearFields);

              if (request.query.format && request.query.format === "csv") {
                const csv_results = await Converter.json2csvAsync(_flattenJSON(results), json2csvOptions)
                  .then((csv) => {

                    return csv;
                  })
                  .catch((err) => {

                    console.log(err);
                    throw err;    
                  });

                return h.response(csv_results).code(200);
              }

              return h.response(results).code(200);
            }

            return h.response({ "statusCode": 404, 'message': 'No records found' }).code(404);
          }
          catch (err) {
            console.log(err);
            return h.response({ statusCode: 503, error: "server error", message: "database error" }).code(503);
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
            freetext: Joi.string().optional()
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
        tags: ['events','auth','api']
      }
    });

    server.route({
      method: 'GET',
      path: '/event_exports/{id}',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;
      
        const query = { _id: new ObjectID(request.params.id) };

        const lookup = {
          from: eventAuxDataTable,
          localField: "_id",
          foreignField: "event_id",
          as: "aux_data"
        };

        const aggregate = [];
        aggregate.push({ $match: query });
        aggregate.push({ $lookup: lookup });

        // console.log(aggregate)

        try {
          const results = await db.collection(eventsTable).aggregate(aggregate).toArray();

          if (results.length > 0) {
            results.forEach(_renameAndClearFields);
            return h.response(results[0]).code(200);
          }
 
          return h.response({ "statusCode": 404, 'message': 'No records found' }).code(404);
          
        }
        catch (err) {
          console.log(err);
          return h.response({ statusCode: 503, error: "server error", message: "database error" }).code(503);
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
        tags: ['events','auth','api']
      }
    });
  }
};