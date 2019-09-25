// Runs in the background chrome extension process. Messages out to popup code running in toolbar and
// to BT app code running in a web page and served from a remote server.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file, when I create one.

'use strict';

chrome.runtime.onInstalled.addListener(function() {});
var BTTab;
var AllNodes;                   // array of BTNodes
var OpenLinks = new Object();   // hash of node name to tab id
var OpenNodes = new Object();   // hash of node name to window id

chrome.runtime.onMessage.addListener((msg, sender) => {
    // Handle messages from bt win content script and popup
    console.log('background.js got message:', msg);
    console.count("BG-IN:" + msg.msg);
    switch (msg.from) {
    case 'btwindow':
        if (msg.msg == 'window_ready') { 
            chrome.tabs.sendMessage(                        // send over gdrive app info
                BTTab,
                {'type': 'keys', 'client_id': config.CLIENT_ID, 'api_key': config.API_KEY},
                {} , 
                function (rsp) {
                    console.log("sent keys, rsp: " + rsp);
                });
            console.count('keys');
            restartExtension();
        }
        if (msg.msg == 'ready') {
            // maybe give original window focus here?
            chrome.storage.local.get('nodes', function(data) {
                var nodes = JSON.parse(data.nodes);
                var chromeNode;
                AllNodes = new Array();
                nodes.forEach(function(node) {
                    chromeNode = new BTChromeNode(node._id, node._title, node._text, node._level, node._parentId);
                    AllNodes[chromeNode.id] = chromeNode;
                    // restore open state w tab and window ids. preserves state acrtoss refreshes
                    // These are object structures indexind by _title
                    chromeNode.tabId = OpenLinks[node._title] ? OpenLinks[node._title] : null; 
                    chromeNode.windowId = OpenNodes[node._title] ? OpenNodes[node._title] : null;
                });
                BTNode.topIndex = AllNodes.length;
            });
        }
        if (msg.msg == 'link_click') {
            openLink(msg.nodeId, msg.url);
        }
        if (msg.msg == 'tag_open') {
            openTag(msg.parent, msg.data);
        }
        if (msg.msg == 'node_deleted') {
            deleteNode(msg.nodeId);
        }
        break;
    case 'popup':
        if (msg.msg == 'moveTab') {
            var tabId = msg.tabId;
            var tag = msg.tag;
            moveTabToWindow(tabId, tag);
        }
        break;
    }
});

function indexInParent(nodeId) {
    // for tab ordering
    let id = parseInt(nodeId);
    let kid = AllNodes[id];
    let parent = kid ? AllNodes[kid.parentId] : null;
    if (!kid || !parent) return 0;
    let index = 0;
    parent.childIds.some(function(id) {
        if (id == nodeId) return true;          // exit when we get to this node
        let n = AllNodes[id];
        if (n && n.tabId) index++;
    });
    return index;
}

function openLink(nodeId, url) {
    // handle click on a link - open in appropriate window
    var BTNode = AllNodes[nodeId];
    if (BTNode.tabId && BTNode.windowId) {
        // tab exists just highlight it (nb convert from tabId to offset index)
        chrome.windows.update(BTNode.windowId, {'focused': true});
        chrome.tabs.get(BTNode.tabId, function(tab) {
            chrome.tabs.highlight({'tabs': tab.index});
        });
        return;
    }
    var parentNode = AllNodes[BTNode.parentId];
    if (!parentNode) parentNode = BTNode;                  // open as its own window

    var index = indexInParent(nodeId);
    if (parentNode.windowId)
        // open tab in this window
        chrome.tabs.create({'windowId': parentNode.windowId,
                            'index': index, 'url': url},
                           function(tab) {
                               BTNode.tabId = tab.id;
                               BTNode.windowId = parentNode.windowId;
                               BTNode.url = url;
                               OpenLinks[BTNode.title] = BTNode.tabId;
                               chrome.windows.update(BTNode.windowId, {'focused': true});
                               chrome.tabs.get(BTNode.tabId, function(tab) {
                                   chrome.tabs.highlight({'tabs': tab.index});
                               });
                           });
    else
        // open new window and assign windowId
        chrome.windows.create({'url': url, 'left': 500}, function(window) {
            parentNode.windowId = window.id;
            OpenNodes[parentNode.title] = window.id;
            BTNode.tabId = window.tabs[0].id;
            BTNode.windowId = window.id;
            BTNode.url = url;
            OpenLinks[BTNode.title] = BTNode.tabId;
        });
    // Send back message that the bt and parent nodes are opened in browser
    chrome.tabs.sendMessage(
        BTTab,
        {'type': 'tab_opened', 'BTNodeId': BTNode.id, 'BTParentId': parentNode.id});
    console.count('tab_opened');
}

function openTag(parentId, data) {
    // passed an array of {nodeId, url} to open in top window
    var ary = data;
    var parentNode = AllNodes[parentId];
    if (!parentNode) return;                                    // shrug
    if (parentNode.windowId) {
        // for now close and re-open, shoudl be more elegant
        var win = parentNode.windowId;
        parentNode.windowId = null;
        chrome.windows.remove(win, function() {
            openTag(parentId, data); // once more from the top
        });
    } else {
        // Create array of urls to open
        var urls = []
        for (var i=0; i<ary.length; i++) {
            urls.push(ary[i].url);
            AllNodes[ary[i].nodeId].url = ary[i].url;
        }
        chrome.windows.create({'url': urls, 'left': 500}, function(win) {
            // When done record window in local node store (also need tabs?) and send back message per tab
            var id, tab, node;
            parentNode.windowId = win.id;
            OpenNodes[parentNode.title] = win.id;
            for (var i=0; i<ary.length; i++) {
                id = ary[i].nodeId;
                node = AllNodes[id];
                node.windowId = win.id;
                tab = win.tabs.find(function(element) {
                    return (compareURLs(element.url, AllNodes[id].url));
                });
                node.tabId = tab.id;
                OpenLinks[node.title] = node.tabId;
                chrome.tabs.sendMessage(
                    BTTab,
                    {'type': 'tab_opened', 'BTNodeId': id, 'BTParentId': parentId});
                console.count('tab_opened'); 
            }});
    }
}
            
                              
function deleteNode(id) {
    // node was deleted in BT ui. Just do the housekeeping here

    var node = AllNodes[id];
    
    // Remove from parent
    var parent = AllNodes[node.parentId];
    if (parent)
        parent.removeChild(id);
    
    delete(AllNodes[id]);
}

function moveTabToWindow(tabId, tag) {
    // Find BTNode associated w tag, move tab to its window if exists, else create it
    
    var tagNode = BTNode.findFromTitle(tag) || new BTChromeNode(BTNode.topIndex++, tag, "", 1, null);
    AllNodes[tagNode.id] = tagNode;
    
    if (tagNode.windowId)
        chrome.tabs.move(tabId, {'windowId': tagNode.windowId, 'index': -1}, function(deets) {
            chrome.tabs.highlight({'windowId': tagNode.windowId, 'tabs': deets.index});
            chrome.windows.update(tagNode.windowId, {'focused': true});
        });
    else
        chrome.windows.create({'tabId': tabId}, function(window) {
            tagNode.windowId = window.id;
        });

    // get tab url, then create and store new BT node
    chrome.tabs.get(tabId, function(tab) {
        var linkNode = new BTChromeNode(BTNode.topIndex++, tab.url, "", tagNode.level + 1, tagNode.id);
        linkNode.tabId = tabId;
        linkNode.windowId = tagNode.windowId;
        AllNodes[linkNode.id] = linkNode;
        
        // Send back message that the link and tag nodes are opened in browser
        chrome.tabs.sendMessage(
            BTTab,
            {'type': 'tab_opened', 'BTNodeId': linkNode.id, 'BTParentId': tagNode.id});
        console.count('tab_opened'); 
    });
}

function restartExtension() {
    // Since we're restarting close windows and clear out the cache of opened nodes

    const tabs = Object.values(OpenLinks);
    if (tabs.length) {
        alert("Closing BrainTool controlled windows!");
        console.log("Restarting Extension");
        chrome.tabs.remove(tabs);
    }
    
    OpenLinks = new Object();
    OpenNodes = new Object();
}

function compareURLs(first, second) {
    // sometimes I get trailing /'s other times not, also treat http and https as the same
    first = first.replace("https", "http").replace(/\/$/, "");
    second = second.replace("https", "http").replace(/\/$/, "");
    return (first == second);
}

function parentUpdate(node) {
    // If as a result of a close/nav this tabs/nodes parent is now empty of BT nodes update app
    const parent = AllNodes[node.parentId];
    if (!parent) return;
    let numKids = 0;
    parent.childIds.forEach(function(childId) {
        if (AllNodes[childId].tabId)
            numKids++;
    });
    if (!numKids) {
        chrome.tabs.sendMessage(
            BTTab,
            {'type': 'tab_closed', 'BTNodeId': parent.id});
        console.count('tab_closed'); 
    }
    // NB leaving the parents windowId set so that any new tabs opened will be in its window
}


chrome.tabs.onRemoved.addListener((tabId, otherInfo) => {
    // listen for tabs being closed, if its a managed tab let BT know
    if (tabId == BTTab) {
        console.log("BT closed!");
        BTTab = null;
        AllNodes = [];
        return;
    }
    var node = AllNodes ? AllNodes.find(function(node) {
        return (node && (node.tabId == tabId));}) : null;
    if (!node) return;
    delete OpenLinks[node.title];
    node.tabId = null; node.windowId = null;
    console.log("closed tab:" + tabId);
    chrome.tabs.sendMessage(
        BTTab,
        {'type': 'tab_closed', 'BTNodeId': node.id});
    console.count('tab_closed');
    
    // if this was the only bt tab in the window let app know
    parentUpdate(node);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, state) => {
    // Handle a BT tab being migrated to a new url
    if (!AllNodes || !changeInfo.url) return;                 // don't care
    var node = AllNodes ? AllNodes.find(function(node) {
        return (node && (node.tabId == tabId));}) : null;
    if (!node) return;
    if (compareURLs(node.url, changeInfo.url)) return;

    // Don't let BT tabs escape! Open any navigation in a new tab
    chrome.tabs.goBack(node.tabId);
    chrome.tabs.create({'windowId': node.windowId, 'url': changeInfo.url});
});

chrome.windows.onRemoved.addListener((windowId) => {
    // listen for windows being closed
    var node = AllNodes ? AllNodes.find(function(node) {
        return (node && (node.windowId == windowId));}) : null;
    if (!node) return;
    delete OpenNodes[node.title];
    console.log("closed window:" + windowId);
    node.windowId = null; node.tabId = null;
    chrome.tabs.sendMessage(
        BTTab,
        {'type': 'tab_closed', 'BTNodeId': node.id});
    console.count('window_closed'); 
});

/*
// listen for navigation completion and update model accordingly. no current use cases.
chrome.webNavigation.onCompleted.addListener(
    function() {
        alert("opened!");
        //btwindow.postMessage("hey", "*");
    },
    {url: [{urlContains : 'localhost'}]
    }
);
*/

