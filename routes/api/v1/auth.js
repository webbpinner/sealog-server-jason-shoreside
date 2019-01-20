'use strict';
const nodemailer = require('nodemailer');
const SECRET_KEY = require('../../../config/secret');

//const Boom = require('boom');
const Bcrypt = require('bcryptjs');
const Joi = require('joi');
const Jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');

const resetPasswordTokenExpires = 15 //minutes

const {
  usersTable,
} = require('../../../config/db_constants');

const {
  emailAddress, emailPassword, reCaptchaSecret
} = require('../../../config/shoreside_constants');

const passwordResetUrl = 'http://localhost:8080/resetPassword/'
const emailTransporter = nodemailer.createTransport({
 service: 'gmail',
 auth: {
        user: emailAddress,
        pass: emailPassword
    }
});

const _rolesToScope = (roles) => {

  if(roles.includes("admin")){
    return ['admin']
  }

  let scope = roles.reduce((scope_accumulator, role) => {
    if (role = 'event_watcher') {
      scope_accumulator.concat(['read_events', 'read_cruises', 'read_lowerings'])
    } else if (role = 'event_logger') {
      scope_accumulator.concat(['read_events', 'write_events', 'read_event_templates', 'write_event_templates', 'read_cruises', 'read_lowerings'])
    } else if (role = 'cruise_manager') {
      scope_accumulator.concat(['read_events', 'write_events', 'read_event_templates', 'write_event_templates', 'read_cruises', 'write_cruises', 'read_lowerings', 'write_lowerings', 'read_users', 'write_users'])
    }

    return scope_accumulator;
  }, [])

  return [...new Set(scope)];
};

const saltRounds = 10;

exports.plugin = {
  name: 'routes-auth',
  dependencies: ['hapi-mongodb'],
  register: async (server, options) => {

    // Need to add a register route
    server.route({
      method: 'POST',
      path: '/register',
      async handler(request, h) {
      
        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        const captchaPayload = {
          secret: reCaptchaSecret,
          response: request.payload.reCaptcha,
          remoteip: request.info.remoteAddress
        }

        try {
          const result = await db.collection(usersTable).findOne({ username: request.payload.username })
          if(result) {

            return h.response({statusCode: 401, error: "invalid registration", message: 'username already exists'}).code(401);
          }
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }

        try {
          const result = await db.collection(usersTable).findOne({ email: request.payload.email })
          if(result) {

            return h.response({statusCode: 401, error: "invalid registration", message: 'email already exists'}).code(401);
          }
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }

        try {
          const reCaptchaVerify = await axios.get('https://www.google.com/recaptcha/api/siteverify?secret=' + reCaptchaSecret + '&response=' + request.payload.reCaptcha + '&remoteip=' + request.info.remoteAddress,
          );

          if(!reCaptchaVerify.data.success) {
            return h.response({statusCode: 401, error: "unauthorized", message: "reCaptcha failed" }).code(401)
          }
        } catch(err) {
           console.log(err)
           return h.response({statusCode: 503, error: "reCaptcha error", message: "unknown error" }).code(503)
        }
   
        let user = request.payload;
        delete user.reCaptcha

        user.last_login = new Date();
        user.roles = ["event_watcher"];

        let password = request.payload.password;

        const hashedPassword = await new Promise((resolve, reject) => {
          Bcrypt.hash(password, saltRounds, function(err, hash) {
            if (err) reject(err)
            resolve(hash)
          });
        })

        user.password = hashedPassword;

        try {
          const result = await db.collection(usersTable).insertOne(user);
          if (!result) {
            return h.response({ "statusCode": 400, 'message': 'Bad request'}).code(400);
          }

          const mailOptions = {
            from: emailAddress, // sender address
            to: request.payload.email, // list of receivers
            subject: 'Welcome to Sealog', // Subject line
            html: '<p>Welcome to Sealog. If you are recieving this email you have just created an account on Sealog.</p><p>If you have any questions please reply to this email address</p><p>Thanks!</p>'
          };

          emailTransporter.sendMail(mailOptions, function (err, info) {
            if(err)
              console.log(err)
            // else
              // console.log(info);
          });

          return h.response({ n: result.result.n, ok: result.result.ok, insertedCount: result.insertedCount, insertedId: result.insertedId }).code(201);

        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        validate: {
          payload: {
            reCaptcha: Joi.string().required(),
            username: Joi.string().min(1).max(50).required(),
            fullname: Joi.string().min(1).max(50).required(),
            email: Joi.string().min(1).max(50).required(),
            password: Joi.string().allow('').max(50).required()
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
            }),
            503: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            }),
          }
        },
        description: 'This is the route used for registering new users.',
        notes: '<div class="panel panel-default">\
          <div class="panel-heading"><strong>Status Code: 200</strong> - registration successful</div>\
          <div class="panel-body">Returns JSON object conatining username and JWT token</div>\
        </div>\
        <div class="panel panel-default">\
          <div class="panel-heading"><strong>Status Code: 400</strong> - bad request</div>\
          <div class="panel-body">Returns JSON object explaining error</div>\
        </div>\
        <div class="panel panel-default">\
          <div class="panel-heading"><strong>Status Code: 422</strong> - user already exists</div>\
          <div class="panel-body">Returns JSON object explaining error</div>\
        </div>',
        tags: ['register', 'auth', 'api']
      }
    });

    // Need to add a register route
    server.route({
      method: 'PATCH',
      path: '/resetPassword',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        const captchaPayload = {
          secret: reCaptchaSecret,
          response: request.payload.reCaptcha,
          remoteip: request.info.remoteAddress
        }

        try {
          const reCaptchaVerify = await axios.get('https://www.google.com/recaptcha/api/siteverify?secret=' + reCaptchaSecret + '&response=' + request.payload.reCaptcha + '&remoteip=' + request.info.remoteAddress,
          );

          if(!reCaptchaVerify.data.success) {
            return h.response({statusCode: 401, error: "unauthorized", message: "reCaptcha failed" }).code(401)
          }
        } catch(err) {
           console.log(err)
           return h.response({statusCode: 503, error: "reCaptcha error", message: "unknown error" }).code(503)
        }

        let user = null
        try {
          const result = await db.collection(usersTable).findOne({ resetPasswordToken: request.payload.token })
          if(!result) {
            return h.response({statusCode: 401, error: 'invalid token', message: 'password reset token is invalid'}).code(401);
          } else if(result.resetPasswordExpires < new Date().getTime()) {
            const resetUser = await db.collection(usersTable).update({_id: result._id}, { $set: {resetPasswordToken: null, resetPasswordExpires: null}});
            return h.response({statusCode: 401, error: 'invalid token', message: 'password reset token has expired'}).code(401);
          } else {
            user = result
          }
        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }

        let password = request.payload.password;

        const hashedPassword = await new Promise((resolve, reject) => {
          Bcrypt.hash(password, saltRounds, function(err, hash) {
            if (err) reject(err)
            resolve(hash)
          });
        })

        try {
          const result = await db.collection(usersTable).update({_id: user._id}, { $set: {password: hashedPassword, resetPasswordToken: null, resetPasswordExpires: null}});

          return h.response({statusCode: 204, message: "password updated"}).code(204);

        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        validate: {
          payload: {
            token: Joi.string().required(),
            reCaptcha: Joi.string().required(),
            password: Joi.string().allow('').max(50).required()
          }
        },
        response: {
          status: {
            204: Joi.object({
              statusCode: Joi.number().integer(),
              message: Joi.string()
            }),
            401: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            }),
            503: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            }),
          }
        },
        description: 'This is the route used for registering new users.',
        notes: 'The POST payload must include a username, full name, password, email address and reCaptcha hash key',
        tags: ['register', 'auth', 'api']
      }
    });

    server.route({
      method: 'POST',
      path: '/login',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        let user = null

        try {
          const result = await db.collection(usersTable).findOne({ username: request.payload.username })
          if (!result) {
            return h.response({statusCode: 401, error: "unauthorized", message: "unknown user or bad password" }).code(401);
          }
          user = result;
          // console.log(result)
          
          // console.log("Password:", request.payload.password)
          // console.log("Password_Hash:", user.password)
          let pass = Bcrypt.compareSync(request.payload.password, user.password)

          if (!pass) {
            return h.response({statusCode: 401, error: "unauthorized", message: "unknown user or bad password" }).code(401);
          }
        } catch (err) {
            console.log("ERROR:", err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }


        try {
          const reCaptchaVerify = await axios.get('https://www.google.com/recaptcha/api/siteverify?secret=' + reCaptchaSecret + '&response=' + request.payload.reCaptcha + '&remoteip=' + request.info.remoteAddress,
          );

          if(!reCaptchaVerify.data.success) {
            return h.response({statusCode: 401, error: "unauthorized", message: "reCaptcha failed" }).code(401)
          }
        } catch(err) {
           console.log(err)
           return h.response({statusCode: 503, error: "reCaptcha error", message: "unknown error" }).code(503)
        }

        user.last_login = new Date();

        try {
          const result = await db.collection(usersTable).update({ _id: new ObjectID(user._id) }, {$set: user})
          if (!result) {
            console.log("ERROR:", err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
          }
          return h.response({ token: Jwt.sign( { id:user._id, scope: _rolesToScope(user.roles), roles: user.roles}, SECRET_KEY), id: user._id.toString() }).code(200);

        } catch (err) {
          console.log("ERROR:", err);
          return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        validate: {
          payload: {
            reCaptcha: Joi.string().required(),
            username: Joi.string().min(1).max(50).required(),
            password: Joi.string().allow('').max(50).required()
          }
        },
        response: {
          status: {
            200: Joi.object({
              token: Joi.string().regex(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/),
              id: Joi.string()
            }),
            401: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            }),
            503: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            }),
          }
        },
        description: 'Obtain JWT authenication via user/pass.',
        notes: 'Use this method to obtain a JWT based on the provided username/password.\
          To prevent BOT abuse this call also requires a captcha hash key',
        tags: ['login', 'auth', 'api']
      }
    });

    server.route({
      method: 'GET',
      path: '/validate',
      async handler(request, h) {
        return h.response({status:"valid"}).code(200);
      },
      config: {
        auth: {
          strategy: 'jwt',
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          options: {
            allowUnknown: true
          }
        },
        description: 'This is the route used for verifying the JWT is valid.',
        notes: 'Simple utiliy route that verifies the JWT included in the http call header is valid.',
        tags: ['login', 'auth', 'api']
      }
    });

    server.route({
      method: 'GET',
      path: '/api_keys/{api_key_name}/build',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = server.mongo.ObjectID;

        try {
          const user = await db.collection(usersTable).findOne({ _id: ObjectID(request.auth.credentials.id) })
          if (!user) {
            return h.response({statusCode: 401, error: "unauthorized", message: "api key is for an unknown user" }).code(401);
          } else {

            const api_key = user.api_keys.find(key => key.api_key_name === request.params.api_key_name)

            if(!api_key) {
              return h.response({statusCode: 404, error: "not found", message: "api key not found on this user account" }).code(401);
            } else {
              return h.response({ api_key: Jwt.sign( { id:user._id.toString(), api_key_name: api_key.api_key_name, scope: api_key.api_key_scope, roles: [] }, SECRET_KEY) }).code(200);
            }
          }
        } catch (err) {
            console.log("ERROR:", err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        auth: {
          strategy: 'jwt',
          scope: ["full"]
        },
        validate: {
          headers: {
            authorization: Joi.string().required()
          },
          params: {
            api_key_name: Joi.string().min(1).max(32).required(),
          },
          options: {
            allowUnknown: true
          }
        },
        response: {
          status: {
            200: Joi.object({
              api_key: Joi.string().regex(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/),
            }),
          }
        },
        description: 'This is the route used for building the API keys.',
        tags: ['api_key', 'auth', 'api']
      }
    });

    server.route({
      method: 'POST',
      path: '/forgotPassword',
      async handler(request, h) {

        const db = request.mongo.db;
        const ObjectID = request.mongo.ObjectID;

        try {
          const reCaptchaVerify = await axios.get('https://www.google.com/recaptcha/api/siteverify?secret=' + reCaptchaSecret + '&response=' + request.payload.reCaptcha + '&remoteip=' + request.info.remoteAddress,
          //const reCaptchaVerify = await axios.post('https://www.google.com/recaptcha/api/siteverify',
          //  {
          //    secret: reCaptchaSecret,
          //    response: request.payload.reCaptcha,
          //    remoteip: request.info.remoteAddress
          //  }
          );

    // console.log(reCaptchaVerify.data)
          // console.log(request.info.remoteAddress)

          if(!reCaptchaVerify.data.success) {
            return h.response({statusCode: 401, error: "unauthorized", message: "reCaptcha failed" }).code(401)
          }
        } catch(err) {
            console.log(err)
           return h.response({statusCode: 503, error: "reCaptcha error", message: "unknown error" }).code(503)
        }

        try {
          const result = await db.collection(usersTable).findOne({ email: request.payload.email })
          if (!result) {
            return h.response({statusCode: 401, error: "invalid", message: "no user found for that email address" }).code(401);
          }
          let user = result;
          
          let token = crypto.randomBytes(20).toString('hex')
          
          const userUpdate = await db.collection(usersTable).update({ _id: user._id }, { $set: {resetPasswordToken: token, resetPasswordExpires: Date.now() + (resetPasswordTokenExpires * 60 * 1000)} })

          let link = passwordResetUrl + token
          const mailOptions = {
            from: emailAddress, // sender address
            to: request.payload.email, // list of receivers
            subject: 'Sealog Password Reset Request', // Subject line
            html: '<p>Sealog has recieved a request to reset the Sealog account associated with this email address. If you did not request this then please just ignore this message. If you would like to change your password please click on the link below.  This link will expire in ' + resetPasswordTokenExpires + ' minutes:</p><p><a href=' + link + '>' + link + '</a></p><p>Please do not reply to this email address as it is rarely checked. If you have any questions please contact @DataRat on Spectrum.</p><p>Thanks!<br/>-@DataRat</p>'
          };

          emailTransporter.sendMail(mailOptions, function (err, info) {
            if(err)
              console.log(err)
            // else
              // console.log(info);
          });
          return h.response({statusCode:200, message:"password reset email sent"}).code(200);

        } catch (err) {
            console.log("ERROR:", err);
            return h.response({statusCode: 503, error: "server error", message: "database error"}).code(503);
        }
      },
      config: {
        validate: {
          payload: {
            email: Joi.string().min(1).max(50).required(),
            reCaptcha: Joi.string().required(),
          }
        },
        response: {
          status: {
            200: Joi.object({
              statusCode: Joi.number().integer(),
              message: Joi.string()
            }),
            401: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            }),
            503: Joi.object({
              statusCode: Joi.number().integer(),
              error: Joi.string(),
              message: Joi.string()
            }),
          }
        },
        description: 'Obtain JWT authenication via user/pass.',
        notes: 'Use this method to obtain a JWT based on the provided username/password.\
          To prevent BOT abuse this call also requires a captcha hash key',
        tags: ['login', 'auth', 'api']
      }
    });
  }
};