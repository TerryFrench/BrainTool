// This script is basically just a relay for messages between the app window and the extension.

// Listen for messages from the App
window.addEventListener('message', function(event) {
    // Handle message from Window
    if (event.source != window)
        return;
    console.log(`Content-IN ${event.data.type} from bt.js:`, event);
    switch (event.data.type) {
    case 'tags_updated':
        // pull tags info from message and post to local storage
        chrome.storage.local.set({'tags': event.data.text}, function() {
            console.log("tags set to " + event.data.text);
        });
        break;
    case 'nodes_updated':
        // pull node info from message and post to local storage
        chrome.storage.local.set({'nodes': event.data.text}, function() {
            console.log("nodes set");
        });
        // and let extension know bt window is set
        chrome.runtime.sendMessage({
            from: 'btwindow',
            msg: 'nodes_ready',
        });
        console.count('Content-OUT:ready');
        break;
    case 'node_reparented':
        // pass on
        chrome.runtime.sendMessage({
            from: 'btwindow',
            msg: 'node_reparented',
            nodeId: event.data.nodeId,
            parentId: event.data.parentId,
            index: event.data.index
        });
        console.count('Content-OUT:node_reparented');
        break;
    case 'LOCALTEST':
        // pass on
        chrome.runtime.sendMessage({
            from: 'btwindow',
            msg: 'LOCALTEST',
        });
        break;
    default:
        // handle all other default type messages
        event.data["from"] = "btwindow";
        chrome.runtime.sendMessage(event.data);
    }
});

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((msg, sender, response) => {
    // Handle messages from extension

    console.log(`Content-IN ${msg.type} from background.js:`, msg);
    switch (msg.type) {
    case 'keys':                // info about gdrive app
        window.postMessage({type: 'keys', 'client_id': msg.client_id, 'api_key': msg.api_key});
        response("cheers mate");
        WaitingForKeys = false;
        console.count('Content-OUT:keys');
        break;
    case 'new_tab':             // new tab to be added to BT
        chrome.storage.local.get('tabsList', function (data) {
            var tab = data.tabsList[0];
            window.postMessage({type: 'new_tab', tag: msg.tag, tab: tab, note: msg.note});
            console.count('Content-OUT:new_tab');
        });
        response("cheers mate");
        break;
    case 'tab_opened':          // tab/window opened should indicate in tree
        window.postMessage({type: 'tab_opened', BTNodeId: msg.BTNodeId, BTParentId: msg.BTParentId});
        console.count('Content-OUT:tab_open');
        break;
    case 'tab_closed':          // tab closed, update model and display
        window.postMessage({type: 'tab_closed', BTNodeId: msg.BTNodeId});
        console.count('Content-OUT:tab_closed');
        break;
    case 'error_restore_nodes':
        window.postMessage({type: 'error_restore_nodes'});
        console.count('Content-OUT:error_restore_nodes');
        break;
    }
});


// Let extension know bt window is ready to open gdrive app. Should only run once
var NotLoaded = true;
var WaitingForKeys = true;
if (!window.LOCALTEST && NotLoaded) {
    chrome.runtime.sendMessage({
        from: 'btwindow',
        msg: 'window_ready',
    });
    NotLoaded = false;
    setTimeout(waitForKeys, 500);
    console.count('Content-OUT:window_ready');
}

function waitForKeys() {
    // Fail safe, if request to background script for keys failed we should try try again.
    if (!WaitingForKeys) return;                       // all good
    
    chrome.runtime.sendMessage({
        from: 'btwindow',
        msg: 'window_ready',
    });
    console.count('Content-OUT:window_ready');
    setTimeout(waitForKeys, 1000);
}
