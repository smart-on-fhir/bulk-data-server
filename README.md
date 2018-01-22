# Bulk Data Server

<a href="https://bulk-data.smarthealthit.org" target="_blank">Online Demo</a>


## Installation
First you have to install NodeJS if you don't already have it from https://nodejs.org/. This app has been developed on Node version 7.9 and also tested on Node 8. In case you have older version you might need to also install a newer one. This is easy to do using the Node Version Manager from https://github.com/creationix/nvm. Then clone the repo, install the dependencies and start it:

```sh
git clone https://github.com/smart-on-fhir/bulk-data-server.git
cd bulk-data-server
npm i
npm start
```
You will see something like "Example app listening on http://localhost:9443". Load that URL in your browser to get started.

## Using your own data
1. Use the <a href="https://synthetichealth.github.io/synthea/" target="_blank">Synthea Patient Generator</a> to generate some STU3 patients.
2. Use our importer script to import those synthea patients into our database:
   ```sh
   node import -d /path/to/my/patients/
   ```

## Configuration

You can customize your settings by editing the file `config.js`. You can also pass the following environment variables:

- `NODE_ENV` - Typically this is `production`, `development` or `test`. Defaults to `production`.
- `PORT` - The port to listen on. Defaults to `9444` for running tests and `9443` otherwise.
- `BASE_URL` - The base url for the link generation. Defaults to `http://localhost:${PORT}`.
- `SECRET` - The secret for signing jwt tokens. Defaults to "this-is-our-big-secret". You must set this one.
