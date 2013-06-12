#!/usr/bin/env node

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var https = require("https");
var knox = require('knox');

var client = knox.createClient({
  key: process.env.ACCESS_KEY_ID,
  secret: process.env.SECRET_ACCESS_KEY,
  bucket: process.env.BUCKET_NAME
});

var outstandingReqs = 0;
var data = null;

var sheets = [
  "public-figures",
  "businesses",
  "organizations",
  "private-individuals",
  "members-of-congress"
];


var reqOptions = {};
var bsdReqOptions = {
  host: 'sendto.mozilla.org',
  port: 443,
  path: '/utils/cons_counter/signup_counter.ajax.php?signup_form_id=95',
  method: 'GET',
  headers: {
    'Content-Type': 'text/plain'
  }
};

for (var i in sheets){
  reqOptions[sheets[i]] = {
    host: 'spreadsheets.google.com',
    port: 443,
    path: '/feeds/cells/0AudCSf2RFSmJdDNQZFFYYlI3TTdfR0E4dHhvamFIYUE/' + (parseInt(i) + 1) + '/public/basic?alt=json',
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  };
}

function forEachSheet(fn){
  for (var i in sheets){
    // fn(name, options)
    var sheetName = sheets[i];
    fn(sheetName, reqOptions[sheetName], parseInt(i) + 1);
  }
}

function collectBSDData(){
  outstandingReqs++;
  var req = https.get(bsdReqOptions, function(resp){
    var chunkData = '';

    resp.on('data', function(chunk) {
      chunkData += chunk;
    });

    resp.on('end', function(){
      data['total'] = Number(chunkData);
      complete();
    });

    req.on('error', function(err) {
      complete();
      data['total'] = 0;
      console.log(err);
    });
  });
}

function collectData(){
  data = {};

  collectBSDData();

  forEachSheet(function(sheet, options){
    outstandingReqs++;
    var req = https.get(options, function(resp){
      
      var chunkData = '';

      resp.on('data', function(chunk) {
        chunkData += chunk;
      });

      resp.on('end', function(){
        var doc = JSON.parse(chunkData);
        
        var entries = doc.feed.entry;
        var names = [];
        var name = null;
        for (var i in entries){
          var cell = entries[i].title['$t'];
          var content = entries[i].content['$t']
          
          var matches = cell.match(/(\D+)(\d+)/);
          
          var column = matches[1];
          var row = matches[2];
          
          // If it's the header row, ignore
          if (row !== '1'){
            if (column === 'A'){
              if (name){
                names.push(name.join(' '));
              }
              name = [];
              name[0] = content.trim();
            }
            if (column === 'B'){
              if (content.trim() !== ''){
                name[1] = content;
              }
            }
          }
        }
        data[sheet] = names;
        complete();
      });
    });

    req.on('error', function(err) {
      complete();
      data[sheet] = [];
      console.log(err);
    });
  });
}

function complete(){
  outstandingReqs--;
  if (outstandingReqs == 0){
    saveData(data);
    setTimeout(collectData, 1000 * 60 * 5); // five minutes 
  }
}

function wrapJSONP(data){
  return "function get_dwu_signatories(" + data + ");";
}

function saveData(data){
  var string = JSON.stringify(data);
  put('/signatories.json', string, 'application/json');
  put('/signatories.js', wrapJSONP(string), 'application/javascript');
}

function put(url, string, type){
  
  var req = client.put(url, {
    'Content-Length': Buffer.byteLength(string, 'utf8'),
    'Content-Type': type + ';charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  req.on('response', function(res){
    if (200 == res.statusCode) {
      console.log('saved to %s', req.url);
    }
  });
  req.end(string);
}

collectData();
