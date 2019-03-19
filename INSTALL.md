# Installation Instructions

### Prerequisites

 - [MongoDB](https://www.mongodb.com) >=v3.6.x
 - [nodeJS](https://nodejs.org) >=8.11.x
 - [npm](https://www.npmjs.com) >=5.7.x
 - [git](https://git-scm.com)
 
 
#### Installing MongoDB 3.6 on Ubuntu 18.04 LTS

Recommend using these instuctions up through part one:
https://www.digitalocean.com/community/tutorials/how-to-install-and-secure-mongodb-on-ubuntu-18-04
 
#### Installing NodeJS/npm on Ubuntu 18.04 LTS
Recommend using these instuctions, skipping the distro-version section and following the section on “How to install Using a PPA":
https://www.digitalocean.com/community/tutorials/how-to-install-node-js-on-ubuntu-18-04#how-to-install-using-a-ppa

### Clone the repository

```
cd ~
git clone https://github.com/webbpinner/sealog-server-jason-shoreside.git
```

This should clone the repo to a directory called `~/sealog-server-jason-shoreside`

### Create the configurations files from the included boilerplates

```
cd ~/sealog-server-jason-shoreside
cp ./config/db_constants.js.dist ./config/db_constants.js
cp ./config/manifest.js.dist ./config/manifest.js
cp ./config/path_constants.js.dist ./config/path_constants.js
cp ./config/shoreside_constants.js.dist ./config/shoreside_constants.js
```

### Modify the configuration files

#### db_constants.js ####
This file holds the name of the databases and collection names for the sealog-server instance.  This file only needs to be modified if there will be more than one instance of sealog-server-jason-shoreside running on the physical server (or VM).  In those case the `sealogDB` and `sealogDB_devel` variables will need to be set to unqiue values.

#### manifest.js ####
This file holds the server port number and optionally the ssl information the sealog-server instance.

By default the server runs on port 8000.  To change this set the port number on lines 22, 28 and 34.  The reason this has to be declared 3 times is to allow the port number to change depending on the more the server is run in.  This allows the server to be run in multiple mode on the server without the need to change this file.

If it is desired to host the server via https, uncomment lines 1, 3-6 and 49.  On line 4, replace <privKey.pem> with the full path to the ssl private key file.  On line 5, replace <fullchain.pem> with the full path to the ssl full chain file.

#### path_constants.js ####
This file holds the path information related for an individual sealog server instance.

Set the `IMAGE_PATH`, `CRUISE_PATH` and `LOWERING_PATH` locations to meet your specific installation requirements.  These are the full paths to where the framegrabber image files, cruise files and lowering files are located on the server.

#### shoreside_constants.js ####
This file holds the information related sending emails and reCaptcha integration for an individual sealog server instance.

The `reCaptchaSecret` is the secret key used to verify the reCaptcha challenge.  This key needs to be obtained from Google's reCaptcha admin console.

The `emailAddress` and `emailPassword` are the email/password for the email account used when sending emails to users.  Currently this must be a gmail-based email account.

The `resetPasswordURL` is the base url used when building a the password reset URL.  This should be set to `<hosting protocol>://<client_url>/resetPassword`.  For example, if your client is hosted via https at sealog.oceandatarat.org then `resetPasswordURL` should be set to: `https://sealog.oceandatarat.org/resetPassword`

### Install the nodeJS modules

From a terminal run:
```
cd ~/sealog-server-jason-shoreside
npm install
```

### Starting the sealog-server in development mode

From a terminal run:
```
cd ~/sealog-server-jason-shoreside
npm run start-devel
```

**This will start the server in development mode.**  This means that the server is in uber-verbose mode and that a new clean database is created each time the server starts (i.e. any data added from a previous run is blown away).

Running in development mode will create an admin account (jason:dsl!jason) and 1 regular user account (guest).  There is no password set for the regular account 

### Start the server in production mode

From a terminal run:

```
cd ./sealog-server-jason-shoreside
npm start
```

**This will start the server in production mode.**  This mode will connect to a mongo database that was already setup for use with sealog-server.  If no database is found, sealog-server will attempt to create it.  Running in production mode for the first time will create an admin account (jason:dsl!jason) and 1 regular user account (guest).  There is no password set for the regular account.

## Need to make everything available over port 80?

On some networks it's only possible to access web-services using the standard network ports (i.e. 80, 443).  To use sealog server on these types of networks the API and websocket services will need to be tunnelled through port 80... luckily Apache makes this relatively easy.

### Prerequisites

 - [apache](https://httpd.apache.org)
 - [mod_proxy](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html)
 - [mod_proxy_wstunnel](https://httpd.apache.org/docs/2.4/mod/mod_proxy_wstunnel.html)
 
 Make sure these modules have been enabled within Apache and that Apache has been restarted since the modules were enabled.
 
 ### Update the Apache site configuration
 
 Add the following code block to the apache site configuration (on Ubuntu this is located at: `/etc/apache2/sites-available/000-default.conf`)
 
```
ProxyPreserveHost On
ProxyRequests Off
ServerName <serverIP>
ProxyPass /sealog-server/ http://<serverIP>:8000/sealog-server/
ProxyPassReverse /sealog-server/ http://<serverIP>:8000/sealog-server/
ProxyPass /ws ws://<serverIP>:8000/
ProxyPassReverse /ws ws://<serverIP>:8000/
```

You will need to reload Apache for the changes to take affect.
```
service apache2 restart
```

If everything went correctly you should not be able to access the sealog-server API at `http://<serverIP>:8000/sealog-server/` and the sealog websocket service at `ws://<serverIP>:8000/ws`
