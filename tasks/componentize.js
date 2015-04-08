/*
 * grunt-componentize
 * https://github.com/fortyau/grunt-componentize
 *
 * Copyright (c) 2015 duane
 * Licensed under the MIT license.
 */

'use strict';


// DEPENDENCIES ========================================================================================================
var colors = require('colors');
var path = require('path');
var _ = require('lodash');
var jju = require('jju');
var toSource = require('tosource');
var execSync = require('child_process').execSync;


// CONSTANTS/DEFAULTS ==================================================================================================
var MODULE_NAME = 'componentize';
var TEMPLATE_PATH = path.join(__dirname, 'component.tpl.ejs');
var BOWER_PATH = 'bower.json';
var BOWER_INFO_CMD = 'bower info {name}#{ver}';
var HOST_URL = 'http://localhost:9000';
var JS_PATH = '/scripts/vendor';
var CSS_PATH = '/styles/vendor';
var ASSET_TYPES = ['js', 'css'];
var DEFAULT_DEST = 'dist/componentize.js';
var DICTIONARY = '';
var SERIALIZERS = {
    'jju': function jjuSerializer(obj, serializerOptions) {
        return _.isUndefined(obj) ? 'undefined' : jju.stringify(obj, serializerOptions);
    },
    'json': function jsonSerializer(obj, serializerOptions) {
        return _.isUndefined(obj) ? 'undefined' : JSON.stringify(obj, serializerOptions.replacer, serializerOptions.space);
    },
    'source': function sourceSerializer(obj, serializerOptions) {
        return toSource(obj, serializerOptions.filter, serializerOptions.indent, serializerOptions.startingIndent);
    }
};


// PRIVATE FUNCTIONS ===================================================================================================
/**
 * Lookup the info for a package in the bower repository!
 * @param pkg_name
 * @returns {*}
 */
var getBowerInfo = function(pkg_name, pkg_ver){

    var pkg_info = null;
    var dep_type = null;
    var cmd = BOWER_INFO_CMD.replace("{name}", pkg_name).replace("{ver}", pkg_ver) + ' --json';

    try {
        var response = execSync(cmd, {stdio: [null]});

        pkg_info = JSON.parse(response.toString());

        if(pkg_info && _.size(pkg_info) > 0){
            console.info('      - Fetched info for '.green + pkg_name.bold.green + ' from Bower'.grey);
        }else{
            console.warn('      ^ Could not fetch info for '.grey + pkg_name.red.bold);
        }
    }
    catch (err) {
        console.warn('      ^ Could not fetch info for '.grey + pkg_name.red.bold);
    }

    return pkg_info;
};

/**
 * Capitalize a string
 * @param str
 * @returns {string}
 */
var cap = function(str){
    return str.charAt(0).toUpperCase() + str.slice(1);
};


// THE TASK ============================================================================================================

module.exports = function(grunt) {

  var defaultTemplate = grunt.file.read(TEMPLATE_PATH);
  grunt.template.addDelimiters(MODULE_NAME, '{%', '%}');  // Add delimiters that do not conflict with grunt

  function resolveSerializer(key) {
    var serializer = SERIALIZERS[key] || key;
    if (!_.isFunction(serializer)) {
        grunt.fail.warn('Invalid serializer. Serializer needs to be a function.');
    }
    return serializer;
  }

  grunt.registerMultiTask(MODULE_NAME, 'The best Grunt plugin ever.', function() {

    console.log('**Beginning the componentize task!**'.black.bold.bgBlue);

    // LOCALS FOR THE TASK ---------------------------------------------------------------------------------------------
    // Get any options for this Grunt task
    console.info('Gathering configuration > '.bold.blue);
    console.info('  > Getting options from Grunt config'.cyan);


    /** The component object that we are creating **/
    var comp = this.options({
        app_name: 'fg_component',
        name: 'fg_component',
        dest: DEFAULT_DEST,
        template: defaultTemplate,
        host_url: HOST_URL,
        js_path: JS_PATH,
        delimiters: MODULE_NAME,
        css_path: CSS_PATH,
        bower_path: BOWER_PATH,
        serializer: 'jju',
        serializerOptions: {
            indent: '',
            no_trailing_comma: true
        },
        deps: {
            js: [],
            css: [],
            unknown: []
        }
    });

    comp.name = comp.name.replace('-', '_');

    var transformData = function dataTransformer(data) {
      return _.map(data, function (value, name) {
          return {
              name: name,
              value: serializer.call(this, value, comp.serializerOptions, comp)
          };
      }, this);
    }.bind(this);

    var serializer = resolveSerializer(comp.serializer);
    //------------------------------------------------------------------------------------------------------------------



    // MODELS  ---------------------------------------------------------------------------------------------------------
    var dep_model = {
        name: undefined,
        version: undefined,
        src: undefined,
        type: undefined,
        bower_info: undefined,
        filename: undefined,
        verify_version: undefined,
        verify_presence: undefined,
        getFileName: function(){
            if(!this.filename) {
                if (typeof(this.bower_info.main) === Object && this.bower_info.main.length) {
                    if (this.bower_info.main.length === 1) {
                        this.filename = this.bower_info.main.length[0];
                    }
                } else {
                    this.filename = this.bower_info.main;
                }
            }

            var filename_arr = this.filename.split('/');
            this.filename = filename_arr[filename_arr.length-1].trim();

            return this.filename;
        },
        getSrc: function(){
            return comp.host_url + comp[this.type + '_path'] + '/' + this.getFileName();
        },
        getVersion: function(){
            if(!this.version){
                if(this.bower_info.version){
                    this.version = this.bower_info.version;
                }else{
                    console.warn('  ! Could not determine version for '.red + this.name.red.bold);
                }
            }
            return this.version;
        },
        isValid: function(){
            return !_.isEmpty(this.src) && !_.isEmpty(this.version) && !_.isEmpty(this.name);
        },
        getInfoFromBower: function(){
            this.bower_info = getBowerInfo(this.name, this.version);
            if(this.version === '*' && this.bower_info && this.bower_info.hasOwnProperty('latest')){
                this.bower_info = this.bower_info.latest;
            }
            return this.bower_info;
        },
        fulfillRequirements: function(){
            console.log('  ! Fulfilling requirements for '.yellow + this.name.yellow.bold);
            if(!this.src){
                this.src = this.getSrc();
                console.info('     * ' + 'Determined src' + ' of '.grey + this.src.toString().bold.grey);
            }
            if(!this.version){
                this.version = this.bower_info.version;
                console.info('     * ' + 'Determined version' + ' of '.grey + this.src.toString().bold.grey);
            }
        }
    }; //---------------------------------------------------------------------------------------------------------------




    // Check if bower actually has any dependencies --------------------------------------------------------------------
    console.info('  > Reading the configured dependencies and bower.json file'.cyan);
    var bower = require(path.resolve(comp.bower_path));
    var bower_deps = {};

    console.info('  > Setting the name of the component object'.cyan);
    comp.name = bower.name;

    if(bower && bower.hasOwnProperty('dependencies')){
        bower_deps = bower.dependencies;
        console.info('  > Found '.green + _.size(bower_deps).toString().green + ' dependency(ies) from bower.json'.green);
    }else{
        console.info('  ! Found 0 dependencies in bower.json'.red);
    } //----------------------------------------------------------------------------------------------------------------



    // Determine where those bower dependencies should go...------------------------------------------------------------
    if(_.size(bower_deps) > 0){
        console.info('  > Determining dependency types of each bower component'.yellow);

        // The dependency type could be specifically declared in the configuration
        _.forEach(bower_deps, function(ver, name){
            console.info('    * Resolving dependency'.grey.bold + ' type for: '.grey + name.bold + '#'.grey + ver +'');

            var dep_is_placed = false;  // Ugly switch

            // Loop through the asset types and see if we have one that belongs to both
            // If we do have one like that...then it will get added in both places, if
            // we can't find it anywhere then we will check against the bower repo
            _.forEach(ASSET_TYPES, function(type){
                var d_idx = _.findIndex(comp.deps[type], {name:name});

                if(d_idx >= 0){
                    dep_is_placed = true;   // Trigger the ugly switch
                    comp.deps[type][d_idx] = _.merge(comp.deps[type][d_idx], dep_model);
                    comp.deps[type][d_idx].type = type;
                }
                return;
            });

            if(dep_is_placed){
                return;
            }

            // Not placed - look up in bower
            console.warn('      ! Attempting to lookup type from the Bower repository...'.yellow);

            // "Instantiate" a dependency model object
            var dep = _.merge({
                name: name,
                version: ver
            }, dep_model);

            // Success!
            if(dep.getInfoFromBower()){
                if(dep.bower_info && !dep.bower_info.hasOwnProperty('main')){
                    console.warn('      ^ Could not determine the dependency type for '.grey + name.red.bold + ' (no main attribute)!'.grey);
                    return;
                }

                // If the string is empty, arr is empty, etc
                if(_.size(dep.bower_info.main) === 0){
                    console.warn('      ^ Could not determine the dependency type for '.grey + name.red.bold + ' (multiple main values)!'.grey);
                    return;
                }

                dep.filename = null;

                // If its an array with a single entry then extract
                if(typeof(dep.bower_info.main)===Object && dep.bower_info.main.length){
                    if(dep.bower_info.main.length === 1){
                        dep.filename = dep.bower_info.main.length[0];
                    }
                }else{
                    dep.filename = dep.bower_info.main;
                }

                if(dep.filename && dep.filename.indexOf('.') >= 0){
                    var dep_type = dep.filename.split('.').pop().toLowerCase().trim();
                    dep.type = dep_type;
                    comp.deps[dep_type].push(dep);
                    console.info('      - Resolved '.green + name.bold.green + ' as '.grey + dep_type.toUpperCase().bold.green + ' from Bower'.grey);

                }else{
                    comp.deps['unknown'].push(dep);
                    console.warn('      ^ Could not determine the dependency type for '.grey + name.red.bold);
                }
            }

          return;
        });
    }//-----------------------------------------------------------------------------------------------------------------



    console.info('  > Checking dependency validity'.cyan);
    _.forEach(comp.deps, function(dep, dep_type){
        if(dep_type==='unknown'){
            return;
        }

        _.forEach(dep, function(d, i){

            if(d.isValid()){
            }else{
                comp.deps[dep_type][i].fulfillRequirements();
            }

        });

        console.info('All '.green + dep_type.toUpperCase().green.bold + ' dependencies are done!'.green);
    });


    // Write the file to where we need to! -----------------------------------------------------------------------------
    console.dir(comp);
    var result = grunt.template.process(comp.template, {
      data: _.extend({}, comp, {
          moduleName: comp.name,
          deps: comp.deps
      }),
      delimiters: comp.delimiters
    });

    grunt.file.write(path.join(comp.dest), result);

    console.info('Woot!'.green);
    if(comp.deps.unknown && comp.deps.unknown.length > 0){
        console.warn('We could not resolve '.red.bold + comp.deps.unknown.length.toString().red.bold + ' dependencies!'.red.bold);
    }
  });

};
