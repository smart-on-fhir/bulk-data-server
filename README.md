# Bulk Data Server

<a href="https://bulk-data.smarthealthit.org" target="_blank">Online Demo</a>


## Install
First you have to install NodeJS if you don't already have it from https://nodejs.org/. This app requires Node version 20+. We recommend using the [Node Version Manager (nvm)](https://github.com/creationix/nvm).

Then clone the repo, install the dependencies and start it:

```sh
git clone https://github.com/smart-on-fhir/bulk-data-server.git
cd bulk-data-server
npm i
```

## Use

Run the following command:
```sh
npm start
```
You should see "Server listening on http://localhost:9443", and can open that URL in your browser to load the server's front end.

The bulk-data server can be accessed by clients like the [FHIR Downloader](https://github.com/smart-on-fhir/sample-apps-stu3/tree/master/fhir-downloader). To connect a client, you will need the server's FHIR endpoint that is displayed in the "FHIR Server URL" field towards the bottom of the page.

The server can also handle authenticated requests using the [SMART Backend Services specification](http://docs.smarthealthit.org/authorization/backend-services/). To use it you should have a pair of RS256 private and public keys (the server only require you to input the public key). Alternatively, you can generate the key pair by clicking on the "Generate Keys" button. The other required piece is the "Service URL" which acts as a unique identifier of your client. Once you have the public key and the Service URL, the server will generate a `Client ID` for you. You can also download the settings a client will need in JSON format by using the "Download as JSON" button. These settings include:
- `private_key` - Only included if keys are generated by the server
- `client_id` - client_id to send while authorizing
- `fhir_url` - where to send your FHIR requests
- `token_url` - where to send your authorization requests
- `service_url` - client identifier

Note that changing options may also change some of these settings (the fields that change will flash green).

## Adding your own data

1. Use the <a href="https://synthetichealth.github.io/synthea/" target="_blank">Synthea Patient Generator</a> to generate patients.
2.  Import these patients into the server's database:
   ```sh
   npm run import -- -f 4 -d /path/to/my/patients/
   ```
Note that `-f` is for FHIR version and is required. Use `4` for `R4`, `3` for `STU3` or `2` for `DSTU2`.

## Configuration

You can customize your settings by editing the file `config.js`. You can also pass the following environment variables:

- `NODE_ENV` - Typically this is `production`, `development` or `test`. Defaults to `production`.
- `PORT` - The port to listen on. Defaults to `9444` for running tests and `9443` otherwise.
- `BASE_URL` - The base url for the link generation. Defaults to `http://localhost:${PORT}`.
- `SECRET` - The secret for signing jwt tokens. Defaults to "this-is-our-big-secret". You must set this one.

