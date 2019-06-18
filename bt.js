
//NB Runs in context of BT window, not the background BT extension or the helper btContent scripts

// Client ID and API key from the Developer Console, values storted offline in config.js
var CLIENT_ID = config.CLIENT_ID;
var API_KEY = config.API_KEY;

// Array of API discovery doc URLs for APIs used by the quickstart
var DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
var SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly';

var authorizeButton = document.getElementById('authorize_button');
var signoutButton = document.getElementById('signout_button');

/**
 *  Initializes the API client library and sets up sign-in state
 *  listeners.
 */
function initClient() {
    gapi.client.init({
        apiKey: API_KEY,
        clientId: CLIENT_ID,
        discoveryDocs: DISCOVERY_DOCS,
        scope: SCOPES
    }).then(function () {
        // Listen for sign-in state changes.
        gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);

        // Handle the initial sign-in state.
        updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
        authorizeButton.onclick = handleAuthClick;
        signoutButton.onclick = handleSignoutClick;
    }, function(error) {
        appendPre(JSON.stringify(error, null, 2));
    });
}

/**
 *  Called when the signed in status changes, to update the UI
 *  appropriately. After a sign-in, the API is called.
 */
function updateSigninStatus(isSignedIn) {
    if (isSignedIn) {
        authorizeButton.style.display = 'none';
      //  signoutButton.style.display = 'block';
        FindOrCreateBTFile();
    } else {
        authorizeButton.style.display = 'block';
        signoutButton.style.display = 'none';
    }
}

/**
 *  Sign in the user upon button click.
 */
function handleAuthClick(event) {
    gapi.auth2.getAuthInstance().signIn();
}

/**
 *  Sign out the user upon button click.
 */
function handleSignoutClick(event) {
    gapi.auth2.getAuthInstance().signOut();
}

/**
 * Append a pre element to the body containing the given message
 * as its text node. Used to display the results of the API call.
 *
 * @param {string} message Text to be placed in pre element.
 */
function appendPre(message) {
    var pre = document.getElementById('content');
    var textContent = document.createTextNode(message + '\n');
    pre.appendChild(textContent);
}

/**
 * Find or initialize BT file
 */
var fileid;
function FindOrCreateBTFile() {
    gapi.client.drive.files.list({
        'pageSize': 1,
        'fields': "files(id, name)",
        'q': "name='BrainTool.org' and not trashed"
    }).then(function(response) {
        var files = response.result.files;
        if (files && files.length > 0) {
            var file = files[0];
            fileid = file.id;
            getBTFile();
        } else {
            console.log('BrainTool.org file not found.');
            createStartingBT();
        }
    });
}

function getBTFile() {
    gapi.client.drive.files.get({
        fileId: fileid,
        alt: 'media'
    }).then(
        function(response) {
            //appendPre(response.body);
            processBTFile(response.body);
        },
        function(error) {
            console.log("Error - Could not read BT file");
        });
}


function createStartingBT () {
    // Read the template bt file from the server and upload to gdrive

    var metadata = {
        'name': 'BrainTool.org', // Filename at Google Drive
        'mimeType': 'text/plain' // mimeType at Google Drive
/*      'parents': ['### folder ID ###'], // Folder ID at Google Drive */
    };
    var accessToken = gapi.auth.getToken().access_token; // Here gapi is used for retrieving the access token.
    var form = new FormData();
    
    fetch('/BrainTool.org')     // fetch template file from bt server
        .then(response => {
            if (!response.ok) {
                throw new Error("HTTP error " + response.status);
            }
            return response.blob();
        })
        .then(blob => {
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', blob);

            fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
                method: 'POST',
                headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                body: form,
            }).then((res) => {
                return res.json();
            }).then(function(val) {
                console.log("Created ", val);
                fileid = val.id;
                getBTFile();
            });
        })
        .catch(function () {
            this.dataError = true;
        })
}

var Categories = new Set();     // track tags for future tab assignment
var parseTree;
var nodeId = 1;                 // for jquery.treetable id's
var currentParentTree = [];     // stack to push/pop parent node id
var outputHTML = "";            //"<caption>BrainTool</caption>";            // aggregate html to inject for table
var BTNodes = [];               // internal BT representation of tree

function processBTFile(fileText) {
    // turn the org-mode text into an html table, extract category tags
    parseTree = orgaparse(fileText);
    parseTree.children.forEach(processNode);
    outputHTML += "</tr>";

    var tab = document.getElementById('content');
    tab.innerHTML = outputHTML;
    $("#content").treetable({ expandable: true, initialState: 'expanded', indent: 10 });
    
    // Let extension know about tags list
    var tags = JSON.stringify(Array.from(Categories));
    window.postMessage({ type: 'tags_updated', text: tags});
}

function processNode(node) {
    // handle a orga node
    //console.log ("Type: " + node.type + ", value: " + node.value);
    switch (node.type) {
    case 'headline':
        processHeadline(node);
        break;
    case 'paragraph':
        processPara(node);
        break;
    case 'text':
        processText(node);
        break;
    case 'link':
        processLink(node);
        break;
    case 'section':
        processSection(node);
    }
}

function processSection(node) {
    if (outputHTML.length > 0) outputHTML += "</tr>\n";
    outputHTML += "<tr data-tt-id=" + nodeId;
    if (currentParentTree.length) outputHTML += " data-tt-parent-id = '" + currentParentTree[currentParentTree.length -1] + "'";
    currentParentTree.push( nodeId++);
    outputHTML += ">";
    node.children.forEach(processNode);
    currentParentTree.pop();
}

function processHeadline(node) {
    outputHTML += "<td class='left'>";
    node.children.forEach(processNode);
    outputHTML += "</td>";
}

function processPara(node) {
    outputHTML += "<td>";
    node.children.forEach(processNode);
    outputHTML += "</td>";
}

function processText(node) {
    var txt = node.value;
    if (txt.length > 25)
    {
        var end = 25;
        while ((txt[end++] !== ' ') && (end < txt.length)) {};
        txt = txt.substring(0,end) + '... ';
    }
    outputHTML += txt;
    if (node.parent.type == 'headline')
        Categories.add(txt);
}

function processLink(node) {
    outputHTML += "<a target='_blank' href='" + node.uri.raw + "'>" + node.desc + "</a>"
}
