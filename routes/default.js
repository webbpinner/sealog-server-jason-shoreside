const Joi = require('joi');
const Fs = require('fs');
const Path = require('path');
const Tmp = require('tmp');

const {
  IMAGE_PATH,
  CRUISE_PATH,
  LOWERING_PATH
} = require('../config/path_constants');


const IMAGE_ROUTE = "/files/images";
const CRUISE_ROUTE = "/files/cruises";
const LOWERING_ROUTE = "/files/lowerings";

const handleFileUpload = (path,file) => {

  return new Promise((resolve, reject) => {

    const filename = file.hapi.filename;
    const data = file._data;

    Fs.writeFile(path + '/' + filename, data, (err) => {

      if (err) {
        reject(err);
      }

      resolve({ message: 'Upload successfully!' });
    });
  });
};

const handleFolderDelete = (path) => {

  if (Fs.existsSync(path)) {
    Fs.readdirSync(path).forEach((file) => {

      const curPath = path + "/" + file;
      if (Fs.lstatSync(curPath).isDirectory()) { // recurse
        handleFolderDelete(curPath);
      } 
      else { // delete file
        Fs.unlinkSync(curPath);
      }
    });
    Fs.rmdirSync(path);
  }
};

const handleFileDelete = (filePath) => {

  if (Fs.existsSync(filePath) && Fs.lstatSync(filePath).isFile()) {
    Fs.unlinkSync(filePath);
  }
};


exports.plugin = {
  name: 'routes-default',
  dependencies: ['hapi-mongodb', 'inert'],
  register: (server, options) => {

    server.route({
      method: 'GET',
      path: '/',
      handler(request, h) {

        return h.response({ result: 'Welcome to sealog-server!' }).code(200);
      },
      config: {
        description: 'This is default route for the API.',
        notes: '<div class="panel panel-default">\
          <div class="panel-heading"><strong>Status Code: 200</strong> - request successful</div>\
          <div class="panel-body">Returns simple message</div>\
        </div>',
        response: {
          status: {
            200: Joi.object({
              result: "Welcome to sealog-server!"
            })
          }
        },
        tags: ['default','test']
      }
    });

    server.route({
      method: 'GET',
      path: '/restricted',
      handler(request, h) {

        return h.response({ message: 'Ok, You are authorized.' }).code(200);
      },
      config: {
        auth: {
          strategy: 'jwt'
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          options: {
            allowUnknown: true
          }
        },
        description: 'This is a default route used for testing the jwt authentication.',
        notes: '<div class="panel panel-default">\
          <div class="panel-heading"><strong>Status Code: 200</strong> - request successful</div>\
          <div class="panel-body">Returns JSON object for user record</div>\
        </div>\
        <div class="panel panel-default">\
          <div class="panel-heading"><strong>Status Code: 401</strong> - authentication failed</div>\
          <div class="panel-body">Returns JSON object explaining error</div>\
        </div>',
        response: {
          status: {
            200: Joi.object({
              message: Joi.string()
            }),
            401: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            })
          }
        },
        tags: ['default','test','auth']
      }
    });

    server.route({
      method: 'GET',
      path: CRUISE_ROUTE + '/filepond/load',
      handler(request, h) {

        console.log(request.params);
        return h.response().code(200);
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
          options: {
            allowUnknown: true
          }
        },
        description: 'This route is used for reload files not yet associated with cruises back into filepond.',
        tags: ['cruises','auth','api','file_get']
      }
    });

    server.route({
      method: 'GET',
      path: CRUISE_ROUTE + '/{param*}',
      handler: {
        directory: {
          path: CRUISE_PATH
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
          params: {
            param: Joi.string().required()
          },
          options: {
            allowUnknown: true
          }
        },
        description: 'This route is used for serving files associated with cruises.',
        tags: ['cruises','auth','api','file_get']
      }
    });

    server.route({
      method: 'DELETE',
      path: CRUISE_ROUTE + '/filepond/revert',
      async handler(request, h) {

        try {
          await handleFolderDelete(Path.join(Tmp.tmpdir, request.payload));
        }
        catch (err) {
          throw (err);
        }
        
        return h.response().code(204);
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

          options: {
            allowUnknown: true
          }
        },
        description: 'This route is used for deleting files managed with filepond not yet fully associated with a cruise.',
        tags: ['cruises','auth','api','file_delete']
      }
    });

    server.route({
      method: 'DELETE',
      path: CRUISE_ROUTE + '/{file*}',
      async handler(request, h) {

        const filePath = Path.join(CRUISE_PATH, request.params.file);

        try {
          await handleFileDelete(filePath);
        }
        catch (err) {
          throw (err);
        }

        return h.response().code(204);
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
          options: {
            allowUnknown: true
          }
        },
        description: 'This route is used for deleting files associated with cruises.',
        tags: ['cruises','auth','api','file_delete']
      }
    });

    server.route({
      method: 'POST',
      path: CRUISE_ROUTE + '/filepond/process/{id}',
      async handler(request, h) {

        const { payload } = request;
        let tmpobj = null;
        try {
          tmpobj = Tmp.dirSync({ mode: '0750', prefix: request.params.id + '_' });
        }
        catch (err) {
          throw (err);
        }

        try {
          await handleFileUpload(tmpobj.name, payload.filepond[1]);
          return h.response(Path.basename(tmpobj.name)).code(201);
        }
        catch (err) {
          console.log(err);
          return h.response({ error: "Upload Error", message: err }).code(501);
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'write_cruises']
        },
        payload: {
          maxBytes: 1024 * 1024 * 20, // 5 Mb
          output: 'stream',
          allow: 'multipart/form-data' // important
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: {
            id: Joi.string().length(24).optional()
          },
          payload: {
            file: Joi.any().meta({ swaggerType: 'file' }).allow('').optional()
          },
          options: {
            allowUnknown: true
          }
        },
        description: 'Upload cruise file via filepond',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>cruise_managers</strong></p>',
        tags: ['cruises','auth','api', 'file_upload']
      }
    });

    server.route({
      method: 'POST',
      path: CRUISE_ROUTE + '/{id}',
      async handler(request, h) {

        const { payload } = request;
        try {
          const upload = await handleFileUpload(CRUISE_PATH + "/" + request.params.id, payload.file);
          return h.response({ message: upload.message }).code(201);
        }
        catch (err) {
          throw (err);
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'write_cruises']
        },
        payload: {
          maxBytes: 1024 * 1024 * 20, // 5 Mb
          output: 'stream',
          allow: 'multipart/form-data' // important
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: {
            id: Joi.string().length(24).optional()
          },
          payload: {
            file: Joi.any().meta({ swaggerType: 'file' }).allow('').optional()
          },
          options: {
            allowUnknown: true
          }
        },
        description: 'Upload cruise file',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>cruise_managers</strong></p>',
        tags: ['cruises','auth','api', 'file_upload']
      }
    });

    server.route({
      method: 'GET',
      path: LOWERING_ROUTE + '/filepond/load',
      handler(request, h) {

        console.log(request.params);
        return h.response().code(200);
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
          options: {
            allowUnknown: true
          }
        },
        description: 'This route is used for reload files not yet associated with lowerings back into filepond.',
        tags: ['lowerings','auth','api','file_get']
      }
    });

    server.route({
      method: 'GET',
      path: LOWERING_ROUTE + '/{param*}',
      handler: {
        directory: {
          path: LOWERING_PATH
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
          params: {
            param: Joi.string().required()
          },
          options: {
            allowUnknown: true
          }
        },
        description: 'This route is used for serving files associated with lowerings.',
        tags: ['lowerings','auth','api','file_get']
      }
    });

    server.route({
      method: 'DELETE',
      path: LOWERING_ROUTE + '/filepond/revert',
      async handler(request, h) {

        try {
          await handleFolderDelete(Path.join(Tmp.tmpdir, request.payload));
        }
        catch (err) {
          throw (err);
        }
        
        return h.response().code(204);
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
          options: {
            allowUnknown: true
          }
        },
        description: 'This route is used for deleting files managed with filepond not yet fully associated with a lowering.',
        tags: ['lowerings','auth','api','file_delete']
      }
    });


    server.route({
      method: 'DELETE',
      path: LOWERING_ROUTE + '/{param*}',
      async handler(request, h) {

        const filePath = Path.join(LOWERING_PATH, request.params.param);
        try {
          await handleFileDelete(filePath);
        }
        catch (err) {
          throw (err);
        }

        return h.response().code(204);
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
          options: {
            allowUnknown: true
          }
        },
        description: 'This route is used for deleting files associated with cruises.',
        tags: ['lowerings','auth','api','file_delete']
      }
    });

    server.route({
      method: 'POST',
      path: LOWERING_ROUTE + '/filepond/process/{id}',
      async handler(request, h) {

        const { payload } = request;
        let tmpobj = null;
        try {
          tmpobj = Tmp.dirSync({ mode: '0750', prefix: request.params.id + '_' });
        }
        catch (err) {
          throw (err);
        }

        try {
          await handleFileUpload(tmpobj.name, payload.filepond[1]);
          return h.response(Path.basename(tmpobj.name)).code(201);
        }
        catch (err) {
          console.log(err);
          return h.response({ error: "Upload Error", message: err }).code(501);
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'write_lowerings']
        },
        payload: {
          maxBytes: 1024 * 1024 * 20, // 20 Mb
          output: 'stream',
          allow: 'multipart/form-data' // important
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: {
            id: Joi.string().length(24).optional()
          },
          payload: {
            file: Joi.any().meta({ swaggerType: 'file' }).allow('').optional()
          },
          options: {
            allowUnknown: true
          }
        },
        description: 'Upload lowering file via filepond',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>cruise_managers</strong></p>',
        tags: ['lowerings','auth','api', 'file_upload']
      }
    });

    server.route({
      method: 'POST',
      path: LOWERING_ROUTE + '/{id}',
      async handler(request, h) {

        const { payload } = request;
        try {
          const upload = await handleFileUpload(LOWERING_PATH + "/" + request.params.id, payload.file);
          return h.response({ message: upload.message }).code(201);
        }
        catch (err) {
          throw (err);
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ['admin', 'write_lowerings']
        },
        payload: {
          maxBytes: 1024 * 1024 * 20, // 5 Mb
          output: 'stream',
          allow: 'multipart/form-data' // important
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: {
            id: Joi.string().length(24).optional()
          },
          payload: {
            file: Joi.any().meta({ swaggerType: 'file' }).allow('').optional()
          },
          options: {
            allowUnknown: true
          }
        },
        description: 'Upload lowering file',
        notes: '<p>Requires authorization via: <strong>JWT token</strong></p>\
          <p>Available to: <strong>cruise_managers</strong></p>',
        tags: ['lowerings','auth','api', 'file_upload']
      }
    });

    server.route({
      method: 'GET',
      path: IMAGE_ROUTE + '/{param*}',
      handler: {
        directory: {
          path: IMAGE_PATH
        }
      },
      config: {
        // auth: {
        //   strategy: 'jwt',
        //   scope: ['admin', 'read_events']
        // },
        validate: {
          // headers: {
          //   authorization: Joi.string().required()
          // },
          params: {
            param: Joi.string().required()
          },
          options: {
            allowUnknown: true
          }
        },
        description: 'This route is used for serving image files for cameras.',
        tags: ['api','auth']
      }
    });

    server.route({
      method: 'GET',
      path: '/{path*}',
      handler(request, h) {

        return h.response({ message: 'Oops, 404 Page!' }).code(404);
      },
      config: {
        description: 'This is the route used for handling invalid routes.',
        notes: '<div class="panel panel-default">\
          <div class="panel-heading"><strong>Status Code: 404</strong> - file not found</div>\
          <div class="panel-body">Returns JSON object explaining error</div>\
        </div>',
        response: {
          status: {
            404: Joi.object({
              message: "Oops, 404 Page!"
            })
          }
        },
        tags: ['default']
      }
    });

    server.route({
      method: 'GET',
      path: '/server_time',
      handler(request, h) {

        const timestamp = new Date();
        return h.response({ ts: timestamp }).code(200);
      },
      config: {
        description: 'This is the route used for retrieving the current server time.',
        notes: '<div class="panel panel-default">\
          <div class="panel-heading"><strong>Status Code: 200</strong> - success</div>\
          <div class="panel-body">Returns JSON object containing the current server time (UTC)</div>\
        </div>',
        response: {
          status: {
            200: Joi.object({
              ts: Joi.date().iso()
            })
          }
        },
        tags: ['default','api']
      }
    });
  }
};