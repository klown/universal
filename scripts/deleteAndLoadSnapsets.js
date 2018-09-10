/*!
Copyright 2018 OCAD University

Licensed under the New BSD license. You may not use this file except in
compliance with this License.

You may obtain a copy of the License at
https://github.com/GPII/universal/blob/master/LICENSE.txt
*/

// This script modifies the preferences database:
// 1. Retrieves all the Prefs Safes of type "snapset" (prefsSafesType = "snapset") from the databsse.
// 2. Retrieves all the GPII Keys associated with each snapset Prefs Safe so found,
// 3. Deletes these Prefs Safes and their associated GPII Keys from the database,
// 4. Uploads the new Prefs Safes and their GPII Keys to the database,
// 5. Uploads demo user Prefs Safes and their Keys in to the database, if they are not already present.
// A sample command that runs this script:
// node deleteAndLoadSnapsets.js $COUCHDBURL $BUILD_DATA_DIR $BUILD_DEMOUSER_DIR

"use strict";

var http = require("http"),
    url = require("url"),
    fs = require("fs"),
    fluid = require("infusion");

var gpii = fluid.registerNamespace("gpii");
fluid.registerNamespace("gpii.dataLoader");

fluid.setLogging(fluid.logLevel.INFO);

// Handle command line
if (process.argv.length < 5) {
    fluid.log("Usage: node deleteAndLoadSnapsets.js $COUCHDB_URL $BUILD_DATA_DIR $BUILD_DEMOUSER_DIR [--justDelete]");
    process.exit(1);
}

/**
 * Create a set of options for data loader and a function to retreive them.
 * The options are based on the command line parameters and a set of database
 * constants.
 * @param {Array} processArgv - The command line arguments.
 * @return {Object} - The options.
 */
gpii.dataLoader.initOptions = function (processArgv) {
    var dbOptions = {};
    dbOptions.couchDbUrl = processArgv[2];
    dbOptions.buildDataDir = processArgv[3];
    dbOptions.demoUserDir = processArgv[4];
    if (processArgv.length > 5 && processArgv[5] === "--justDelete") { // for debugging.
        dbOptions.justDelete = true;
    } else {
        dbOptions.justDelete = false;
    }

    // Set up database specific options
    dbOptions.prefsSafesViewUrl = dbOptions.couchDbUrl + "/_design/views/_view/findSnapsetPrefsSafes";
    dbOptions.gpiiKeysViewUrl = dbOptions.couchDbUrl + "/_design/views/_view/findAllGpiiKeys";
    dbOptions.parsedCouchDbUrl = url.parse(dbOptions.couchDbUrl);
    dbOptions.snapsetPrefsSafes = [];
    dbOptions.gpiiKeys = [];
    dbOptions.postOptions = {
        hostname: dbOptions.parsedCouchDbUrl.hostname,
        port: dbOptions.parsedCouchDbUrl.port,
        path: "/gpii/_bulk_docs",
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Length": 0,          // IMPORTANT: FILL IN PER REQUEST
            "Content-Type": "application/json"
        }
    };
    fluid.log("COUCHDB_URL: '" +
        dbOptions.parsedCouchDbUrl.protocol + "//" +
        dbOptions.parsedCouchDbUrl.hostname + ":" +
        dbOptions.parsedCouchDbUrl.port +
        dbOptions.parsedCouchDbUrl.pathname + "'"
    );
    fluid.log("BUILD_DATA_DIR: '" + dbOptions.buildDataDir + "'");
    return dbOptions;
};

/**
 * Find the Prefs Safes of type "snapset", mark them to be deleted and add
 * them to an array of records to remove.
 * @param {String} responseString - The response from the database query for
 *                                  retrieving the snapset PrefsSafes records
 * @param {Object} options - Data loader options used to store the current set
 *                           of processed snapsets.
 * @return {Array} - The snapset PrefsSafes records marked for deletion.
 */
gpii.dataLoader.processSnapsets = function (responseString, options) {
    fluid.log("Processing the snapset Prefs Safes records...");
    var snapSetRecords = JSON.parse(responseString);
    fluid.each(snapSetRecords.rows, function (aSnapset) {
        aSnapset.value._deleted = true;
        options.snapsetPrefsSafes.push(aSnapset.value);
    });
    fluid.log("\tSnapset Prefs Safes marked for deletion.");
    return options.snapsetPrefsSafes;
};

/**
 * Find the GPII Key records that are associated with a snapset PrefsSafe, mark
 * them for deletion, and add them to array of records to delete.
 * @param {String} responseString - The response from the database query for
 *                                  retrieving all the GPII Keys.
 * @param {Object} options - Data loader options used to store the current set
 *                           of snapset GPII keys.
 * @return {Array} - The GPII Key records marked for deletion.
 */
gpii.dataLoader.processGpiiKeys = function (responseString, options) {
    fluid.log("Processing the GPII Keys...");
    var gpiiKeyRecords = JSON.parse(responseString);
    options.gpiiKeys = gpii.dataLoader.markPrefsSafesGpiiKeysForDeletion(
        gpiiKeyRecords, options.snapsetPrefsSafes
    );
    fluid.log("\tGPII Keys associated with snapset Prefs Safes marked for deletion.");
    return options.gpiiKeys;
};

/**
 * Given all the GPII Keys records in the database, find the ones that reference
 * a snapset PrefsSafe.  As each GPII Key is found it is marked for
 * deletion.
 * @param {Array} gpiiKeyRecords - Array of GPII Key records from the database.
 * @param {Array} snapSets - Array of snapset Prefs Safes whose id references
 *                           its associated GPII Key record.
 * @return {Array} - the values from the gpiiKeyRecords that are snapset GPII Keys.
 */
gpii.dataLoader.markPrefsSafesGpiiKeysForDeletion = function (gpiiKeyRecords, snapSets) {
    var gpiiKeysToDelete = [];
    fluid.each(gpiiKeyRecords.rows, function (gpiiKeyRecord) {
        var gpiiKey = fluid.find(snapSets, function (aSnapSet) {
            if (gpiiKeyRecord.value.prefsSafeId === aSnapSet._id) {
                return gpiiKeyRecord.value;
            }
        }, null);
        if (gpiiKey !== null) {
            gpiiKey._deleted = true;
            gpiiKeysToDelete.push(gpiiKey);
        }
    });
    return gpiiKeysToDelete;
};

/**
 * Utility to wrap all the pieces to make a bulk documents deletion request
 * for the snapset Prefs Safes and their associated GPII keys.  Its intended use
 * is the parameter of the appropriate promise.then() call.
 * @param {Object} batchDeleteResponse - the reponse handler configured for the
 *                                       batch delete request.
 * @param {Object} options - Object that contains the records to be deleted.
 * @return {http.ClientRequest} - The http request object.
 */
gpii.dataLoader.configureBatchDelete = function (batchDeleteResponse, options) {
    var docsToRemove = options.snapsetPrefsSafes.concat(options.gpiiKeys);
    return gpii.dataLoader.createBulkDocsRequest(
        docsToRemove, batchDeleteResponse, options
    );
};

/**
 * Create a function that makes a bulk docs POST request using the given data.
 * @param {Object} dataToPost - JSON data to POST and process in bulk.
 * @param {Object} responseHandler - http response handler for the request.
 * @param {Object} options - Data loader options, specifically the POST options.
 * @return {http.ClientRequest} - An http request object.
 */
gpii.dataLoader.createBulkDocsRequest = function (dataToPost, responseHandler, options) {
    var batchPostData = JSON.stringify({"docs": dataToPost});
    options.postOptions.headers["Content-Length"] = Buffer.byteLength(batchPostData);
    var batchDocsRequest = http.request(options.postOptions, responseHandler);
    batchDocsRequest.write(batchPostData);
    return batchDocsRequest;
};

/**
 * Generate a response handler, setting up the given promise to resolve/reject
 * at the correct time.
 * @param {Function} handleEnd - Function to call that deals with the response
 *                               data when the response receives an "end" event.
 * @param {Object} options - Data loader options passed to handleEnd().
 * @param {Promise} promise - Promise to resolve/reject on a response "end" or
 *                           "error" event.
 * @param {String} errorMsg - Optional error message to prepend to the error
 *                            received from a response "error" event.
 * @return {Function} - Function reponse callback for an http request.
 */
gpii.dataLoader.createResponseHandler = function (handleEnd, options, promise, errorMsg) {
    return function (response) {
        var responseString = "";

        response.setEncoding("utf8");
        response.on("data", function (chunk) {
            responseString += chunk;
        });
        response.on("end", function () {
            if (response.statusCode >= 400) {   // error
                var fullErrorMsg = errorMsg +
                                   response.statusCode + " - " +
                                   response.statusMessage;
                // Document-not-found or 404 errors include a reason in the
                // response.
                // http://docs.couchdb.org/en/stable/api/basics.html#http-status-codes
                if (response.statusCode === 404) {
                    fullErrorMsg = fullErrorMsg + ", " +
                                   JSON.parse(responseString).reason;
                }
                promise.reject(fullErrorMsg);
            }
            else {
                var value = handleEnd(responseString, options);
                promise.resolve(value);
            }
        });
        response.on("error", function (e) {
            fluid.log(errorMsg + e.message);
            promise.reject(e);
        });
    };
};

/**
 * General mechanism to create a database request, set up an error handler and
 * return.  It is up to the caller to trigger the request by calling its end()
 * function.
 * @param {String} databaseURL - URL to query the database with.
 * @param {Function} handleResponse - callback that processes the response from
 *                                    the request.
 * @param {String} errorMsg - optional error message for request errors.
 * @return {http.ClientRequest} - The http request object.
 */
gpii.dataLoader.queryDatabase = function (databaseURL, handleResponse, errorMsg) {
    var aRequest = http.request(databaseURL, handleResponse);
    aRequest.on("error", function (e) {
        fluid.log(errorMsg + e.message);
    });
    return aRequest;
};

/**
 * Get all the json files from the given directory, then loop to put their
 * contents into an array of Objects.
 * @param {String} dataDir - Directory containing the files to load.
 * @return {Array} - Each element of the array is an Object based on the
 *                   contents of each file loaded.
 */
gpii.dataLoader.getDataFromDirectory = function (dataDir) {
    var contentArray = [];
    var files = fs.readdirSync(dataDir);
    files.forEach(function (aFile) {
        if (aFile.endsWith(".json")) {
            var fileContent = fs.readFileSync(dataDir + "/" + aFile, "utf-8");
            contentArray = contentArray.concat(JSON.parse(fileContent));
        }
    });
    return contentArray;
};

/*
 * Create the step that fetches the current snapset Prefs Safes from the
 * database.
 * @param {Object} options - Object that has the view for finding snap set
 *                           Prefs Safes records in the database.
 * @return {Promise} - A promise that resolves to the set of snapset PrefsSafes
 *                     currently in the database.
 */
gpii.dataLoader.createFetchSnapsetsStep = function (options) {
    var togo = fluid.promise();
    var response = gpii.dataLoader.createResponseHandler(
        gpii.dataLoader.processSnapsets,
        options,
        togo,
        "Error retrieving snapsets Prefs Safes: "
    );
    var snapSetsRequest = gpii.dataLoader.queryDatabase(
        options.prefsSafesViewUrl,
        response,
        "Error requesting snapsets Prefs Safes: "
    );
    snapSetsRequest.end();
    return togo;
};

/*
 * Create the step that fetches the current GPII keys associate with the snapset
 * Prefs Safes.
 * @param {Object} options - Object that has the view for finding all GPII Key
 *                           records in the database.
 * @return {Promise} - A promise that resolves to the set of GPII keys in the
 *                     database that correspond to snapset PrefsSafes.
 */
gpii.dataLoader.createFetchGpiiKeysStep = function (options) {
    var togo = fluid.promise();
    var response = gpii.dataLoader.createResponseHandler(
        gpii.dataLoader.processGpiiKeys,
        options,
        togo,
        "Error finding snapset Prefs Safes associated GPII Keys: "
    );
    var request = gpii.dataLoader.queryDatabase(
        options.gpiiKeysViewUrl,
        response,
        "Error requesting GPII Keys: "
    );
    request.end();
    return togo;
};

/*
 * Log how many snapset Prefs Safes and GPII Keys were deleted.
 * @param {String} responseString - Response from the database (ignored)
 * @param {Object} options - Object that contains the sets of Prefs Safes and
 *                           their keys.
 * @return {Object} - The number of snapsets and gpiiKeys deleted.
 */
gpii.dataLoader.logSnapsetDeletion = function (responseString, options) {
    fluid.log(  "Deleted " +
                options.snapsetPrefsSafes.length + " Prefs Safes and " +
                options.gpiiKeys.length + " associated GPII Keys, "
    );
    return {
        snapsets: options.snapsetPrefsSafes.length,
        gpiiKeys: options.gpiiKeys.length
    };
};

/*
 * Create the step that deletes, in batch, the current snapset Prefs Safes and
 * their associated GPII keys.
 * @param {Promise} previousStep - Promise from a previous step whose fulfillment
 *                                 triggers the bulk delete request.
 * @param {Object} options - Object that contains the records to be deleted.
 * @return {Promise} - The promise that resolves the deletion.
 */
gpii.dataLoader.createBatchDeleteStep = function (options) {
    var togo = fluid.promise();
    var response = gpii.dataLoader.createResponseHandler(
        gpii.dataLoader.logSnapsetDeletion,
        options,
        togo
    );
    var batchDeleteRequest = gpii.dataLoader.configureBatchDelete(response, options);
    batchDeleteRequest.end();
    return togo;
};

/*
 * Log the uploading of all the snapset and user Prefs Safes.
 * @param {String} responseString - Response from the database (ignored)
 * @param {Object} options - Object that contains the directories from which
 *                           the Prefs Safes were loaded.
 */
gpii.dataLoader.logSnapsetsUpload = function (responseString, options) {
    fluid.log("Bulk loading of build data from '" + options.buildDataDir + "'");
    fluid.log("Bulk loading of demo user data from '" + options.demoUserDir + "'");
    return "Uploaded latest snapsets and demo user preferences";
};

/*
 * Create the step that uploads, in batch, the new snapset Prefs Safes, their
 * associated GPII keys, and the demo user Prefs Safes/GPII Keys.
 * @param {Object} options - Object that has the paths to the directories that
 *                           contain the new snapsets and demo user preferences.
 * @return {Promise} - A promise that resolves the upload.
 */
gpii.dataLoader.createBatchUploadStep = function (options) {
    var togo = fluid.promise();
    var buildData = gpii.dataLoader.getDataFromDirectory(options.buildDataDir);
    var demoUserData = gpii.dataLoader.getDataFromDirectory(options.demoUserDir);
    var allData = buildData.concat(demoUserData);
    var response = gpii.dataLoader.createResponseHandler(
        gpii.dataLoader.logSnapsetsUpload,
        options,
        togo
    );
    var bulkUploadRequest = gpii.dataLoader.createBulkDocsRequest(allData, response, options);
    bulkUploadRequest.end();
    return togo;
};

/*
 * Create and execute the steps to update the database.
 */
gpii.dataLoader.orchestrate = function () {
    var options = gpii.dataLoader.initOptions(process.argv);
    var sequence = [
        gpii.dataLoader.createFetchSnapsetsStep,
        gpii.dataLoader.createFetchGpiiKeysStep,
        gpii.dataLoader.createBatchDeleteStep
    ];
    if (!options.justDelete) {
        sequence.push(gpii.dataLoader.createBatchUploadStep);
    }
    fluid.promise.sequence(sequence, options).then(
        function (/*result*/) {
            fluid.log("Done.");
            process.exit(0);
        },
        function (error) {
            fluid.log(error);
            process.exit(1);
        }
    );
};
gpii.dataLoader.orchestrate();
