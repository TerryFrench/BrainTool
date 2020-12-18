/* 
   Base capabilities and model for a BrainTool node common across app and extension.
   Base Messaging and coordination capabilities will go here as they are refactored out.
*/

class BTNode {
    constructor(title, parentId = null) {
        this._id = BTNode.topIndex++;
        this._title = title;
        this._parentId = parentId;
        this._URL = BTNode.URLFromTitle(title);
	    this._displayTag = BTNode.displayTagFromTitle(title);
        this._childIds = [];
        this._isOpen = false;
        this._tagPath = '';
        this.generateUniqueTagPath();
        if (parentId && AllNodes[parentId]) {
            AllNodes[parentId].addChild(this._id, -1, this._URL != "");
        }
        // Global instance store. Check existence so staticBase, below, works.
        // NB Entries could be overwritten by derived class ctor:
        if (typeof AllNodes !== 'undefined') AllNodes[this._id] = this;    
    }
    static baseNode = new BTNode('');

    get id() {
        return this._id;
    }
    
    set title(ttl) {
        this._title = ttl;
        this._URL = BTNode.URLFromTitle(ttl);         // regenerate URL when title is changed
	    this._displayTag = BTNode.displayTagFromTitle(ttl);
    }
    get title() {
        return this._title;
    }
    get URL() {
        return this._URL;
    }
    get displayTag() {
	    return this._displayTag;
    }
    get tagPath() {
        return this._tagPath;
    }

    set parentId(i) {
        this._parentId = i;
    }
    get parentId() {
        return this._parentId;
    }

    set isOpen(val) {
        // Track whether node is open (highlighted in tree and w an existing tab
        this._isOpen = val;
    }
    get isOpen() {
        return this._isOpen;
    }

    get hasWebLinks() {
	    // Calculate on demand since it may change based on node creation/deletion
	    if (this.URL) return true;
	    return this.childIds.some(id => AllNodes[id].hasWebLinks);
    }

    get childIds() {
        return this._childIds;
    }
    addChild(id, index = -1, isURL = false) {
        if (index < 0) {
            if (isURL)          // add to front
                this._childIds.unshift(parseInt(id));
            else
                this._childIds.push(parseInt(id));
        }
        else
            this._childIds.splice(index, 0, parseInt(id));
    }
    removeChild(id) {
        let index = this._childIds.indexOf(parseInt(id));
        if (index > -1)
            this._childIds.splice(index, 1);
    }
    allDescendents() {
        // return an array of all children and all their children etc
        let ids = [this._id];
        this.childIds.forEach(function (id) {
            ids.push(AllNodes[id].allDescendents());
        });
        return ids.flat(Infinity);
    }

    isTag() {
        // Is this node used as a tag => has webLinked children
        return (this.level == 1) || this.childIds.some(id => AllNodes[id].hasWebLinks);
    }

    toBTNode() {
        // Generic fn to return this objects properties
        let props = {};
        let keys = Object.keys(BTNode.baseNode);
        for (let i =0; i< keys.length; i++){
            props[keys[i]] = this[keys[i]];
        }
        return props;
    }
    
    reparentNode(newP, index = -1) {
        // move node from existing parent to new one, optional positional order
        
        const oldP = this.parentId;
        if (oldP)
            AllNodes[oldP].removeChild(this.id);
        this.parentId = newP;
        if (newP)
            AllNodes[newP].addChild(this.id, index);
    }
    
    static URLFromTitle(title) {
        // pull url from title string (which is in org format: "asdf [[url][label]] ...")
        // nb only find http urls, purposely ignore file: links
        const regexStr = "\\[\\[(http.*?)\\]\\[(.*?)\\]\\]";           // NB non greedy
        const reg = new RegExp(regexStr, "mg");
        const hits  = reg.exec(title);
        return hits ? hits[1] : "";        
    }

    static displayTagFromTitle(title) {
        // Visible tag for this node. Pull tags out, use url if no tag
        let outputStr = title.replace(/\[\[(.*?)\]\[(.*?)\]\]/gm, (match, $1, $2) =>
				      {return $2 || $1;});
        return outputStr;
    }


    static findFromTitle(title) {
        var n = AllNodes.length ? AllNodes.find(function(node) {
            return (node && (node.title == title));}) : null;
        return n ? n.id : null;
    }

    static findFromTagPath(tagPath) {
        var n = AllNodes.find(node => (node && (node.tagPath == tagPath)));
        return n ? n.id : null;
    }

    static reset() {
        // Called when reloading nodes etc
        AllNodes = [];
        BTNode.topIndex = 1;
    }
    
    static topIndex = 1;    // track the index of the next node to create, static class variable.

    
    static processTagString(tag) {
        // Tag string passed from popup can be: tag, tag:TODO, parent:tag or parent:tag:TODO
        // return array[tag, parent, TODO, tagpath]
        tag = tag.trim();
        let match = tag.match(/(.*):(.*):TODO/);
        if (match)                                // parent:tag:TODO form
            return [match[2], match[1], "TODO", match[1]+':'+match[2]];
        match = tag.match(/(.*):TODO/);
        if (match)                                // tag:TODO form
            return [match[1], null, "TODO", match[1]];
        match = tag.match(/(.*):(.*)/);
        if (match)                                // parent:tag form
            return [match[2], match[1], null, match[1]+':'+match[2]];
        
        return [tag, null, null, tag];
    }

    static deleteNode(nodeId) {
        // Cleanly delete this node

        const node = AllNodes[nodeId];
        if (!node) return;

        // recurse to delete children if any
        const children = [...node.childIds];
        children.forEach(BTNode.deleteNode);
        
        // Remove from parent
        const parent = AllNodes[node.parentId];
        if (parent)
            parent.removeChild(nodeId);

        delete(AllNodes[nodeId]);
    }

    generateUniqueTagPath() {
        // same tag can be under multiple parents, generate a unique tagPath
        
        if (this.displayTag == "" || (!this.isTag())) {
            // eg linkNode or non tag
            this._tagPath = this._displayTag;
            return;
        }
        const sameTag = AllNodes.filter(nn => nn.isTag() && nn.displayTag == this.displayTag);
        if (sameTag.length == 1) {
            // unique
            this._tagPath = this._displayTag;
            return;
        }
        sameTag.forEach(function(nn) {
            const parentTag = AllNodes[nn.parentId] ? AllNodes[nn.parentId].displayTag : "";
            nn._tagPath = parentTag + ":" + nn.displayTag;
        });
    }
        
    static generateUniqueTagPaths() {
        // same tag can be under multiple parents, generate a unique tagPath for each node
        AllNodes.forEach(function(n) {
            n.generateUniqueTagPath();
        });
    }


            
}
