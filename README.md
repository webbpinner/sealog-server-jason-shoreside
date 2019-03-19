# sealog-server-jason-shoreside
Sealog event logging server, tweaked to support the JASON ROV shoreside

Sealog is intended as a general purpose eventlogging framework that is independent of any particular user-interface.  All interactions with the Sealog Server are done via the [Sealog Server's RESTful API](<https://sealog-jason-shoreside.oceandatarat.org:8900/sealog-server/documentation>).

This allows for users to develop their own user interfaces for adding, editing and exporting events or extend the functionality of other systems to dynamically submit events.  It's even possible to develop hardware-based clients (physical buttons) using cheap network-aware microcontrollers (i.e Ardinuo w/Ethernet Shield).

Almost all calls to the API are authenticated using Java Web Tokens (JWT).  The only exceptions are the requests related to self-registration of new users and requests to obtaining JWTs (using standard user/pass login creditionals).

### Short-list of features
 - 100% of functionality accessable via RESTful API, completely indenpendent of any graphical/CLI front-end.
 - Ad-hoc association of ancilary data with events such as sensor data, navigation, etc. 
 - Ability to filter events based on user, value, keywords and time spans
 - Ability to subscribe to the live eventlog feed (using websockets).
 - Simple exporting of all or a filtered list of events merged with ancilary data is JSON or CSV format
 - Defining event templates for quick event submission
 - role-based authentication using Java Web Tokens (JWT)

## API Documentation

Please refer to the [Sealog Server's RESTful API](<https://sealog-jason-shoreside.oceandatarat.org:8900/sealog-server/documentation>)

## Installation

For Sealog Server installation instruction please look at [INSTALL.md](https://github.com/webbpinner/sealog-server-jason-shoreside/blob/master/INSTALL.md).

### React/Redux front-end client

[sealog client for JASON](https://github.com/webbpinner/sealog-client-jason-shoreside) is a react/redux-based web-client developed for use with sealog-server-jason-shoreside.

## Want to Contribute?
My intention with sealog-server was to create a production quality eventlogging framework for any one to use... but I don't need to do this alone.  Any and all help is appreciated.  This include helping with the server code, fleshing out the documentation, creating some code examples, identifying bugs and making logical feature requests.  Please contact me at oceandatarat at gmail dot com if you want in on the action.

I've also setup a Slack channel for sealog, please contact me at oceandatarat at gmail dot com if you would like an invitation.

# Current Users
- Sealog Server Jason Shoreside is currently used by the Woods Hole Oceanographic Institution to support shore-based access to event data collected with the JASON ROV.
- Sealog Server Jason Shoreside is currently used by the Inner Space Center at the University of Rhode Island's Graduate School of Oceanography.

# Thanks and acknowledgments
Sealog is in ongoing development thanks to the generosity of the Schmidt Ocean Institute (SOI) who have supported the project since 2018. I also want to thank the Woods Hole Oceanographic Institution who provided the initial inspiration for the project and are slated to become it's first user.

Lastly I want to thank the UNOLS community who have helped me since the beginning by sharing their wealth of experience and technical ability.
