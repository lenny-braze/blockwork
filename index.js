#! /usr/bin/env node

const bb = require('bluebird')
const download = bb.promisify(require('download-git-repo'))
const prompt = bb.promisifyAll(require('prompt'),{suffix:"p"})
const fs = require("fs")
const path = require("path")
const glob = require("glob")
const dot = require("dot")
const getCliArgs = require('minimist')
const {PromiseReadable} = require('promise-readable')
const jsonValidate = require("jsonschema").validate
const CSON = require("cursive")
const didYouMean = require("didyoumean")


var Promise = bb

const blockstoreIndex = CSON.parse(fs.readFileSync(path.join(__dirname,"directory.cson")),{encoding:'utf8'})
const blockstoreNames = Object.keys(blockstoreIndex)
const ignoreCheck = /(^|\n)(\.\/)?blockwork-tmp/
const ignoreSuggest= "blockwork-tmp"
const downloadPath = (name)=>"./blockwork-tmp/"+name.slug
const templateGlob = (name)=>"./blockwork-tmp/"+name.slug+"/*.dot"
const specPath =     (name)=>"./blockwork-tmp/"+name.slug+"/blockwork.spec.json"
const configPath =   (name)=>name.slug+".blockwork.config.cson"
const outputPath = "."
const globOptions = {}
didYouMean.threshold = null
dot.templateSettings = {
		evaluate:    /\<\<\!([\s\S]+?)\>\>/g,
		interpolate: /\<\<\:([\s\S]+?)\>\>/g,
		encode:      /\<\<&([\s\S]+?)\>\>/g,
		use:         /\<\<#([\s\S]+?)\>\>/g,
		define:      /\<\<##\s*([\w\.$]+)\s*(\:|=)([\s\S]+?)#\>\>/g,
		conditional: /\<\<\?(\?)?\s*([\s\S]*?)\s*\>\>/g,
		iterate:     /\<\<\*\s*(?:\>\>|([\s\S]+?)\s*\:\s*([\w$]+)\s*(?:\:\s*([\w$]+))?\s*\>\>)/g,
		varname: 'x',
		strip: false,
		append: true,
		selfcontained: false
	}

main()

async function main(){
		try{
		var argOffset
		if(process.argv[0].match(/blockwork/)){argOffset=1} //e.g. blockwork foo
		if(process.argv[0].match(/node/)){argOffset=2} //e.g. node index.js foo
		if(argOffset===undefined){
				throw "Unexpected usage of script. Please report your use case to https://github.com/fabio-looker/blockwork/issues"
			}
		const cliArgs = getCliArgs(process.argv.slice(argOffset))
		const command = cliArgs._[0]
		const blockName = {
				prop:toASCIICamelCase(cliArgs._[1]),
				slug:camelToHyphen(toASCIICamelCase(cliArgs._[1]))
			}
		switch (command){
			case "install":
					await fetch(blockName)
					await config(blockName)
					await compile(blockName)
				break;
			case "fetch":
					await fetch(blockName);
				break;
			case "config":
					await config(blockName)
				break;
			case "compile":
					await config(blockName,{silent:true})
					await compile(blockName)
				break;
			default:
					console.warn("Missing or unknown command. Try `blockwork install foo`")
				break;
		}
		}catch(e){console.error(e)}
		process.exit(0)
	}

async function fetch(b){
				var suggestion;
				if(!fs.existsSync(".gitignore") || !fs.readFileSync(".gitignore").match(ignoreCheck)){
						console.warn("\x1b[33mWarning:\x1b[0m You probably want '"+ignoreSuggest+"' in your .gitignore")
					}
				if(!b.slug){throw "Block name required."}
				const block = blockstoreIndex[b.prop]
				if(!block){
					if(suggestion = didYouMean(b.prop, blockstoreNames)){
							throw "No registered block with the name " + b.slug +
									"\nMaybe you wanted "+camelToHyphen(suggestion)+"?"
						}else{
							throw "No registered block with the name " + b.slug
						}
				}
				console.log("Fetching block...")
				await download(block.repo || block, downloadPath(b))
				return true
	}
async function config(b,options={}){
		var specString, spec;
		try{
			specString = fs.readFileSync(specPath(b),{encoding:'utf8'})
		}catch(e){throw "This block does not have a blockwork spec. Please file an issue with the block maintainer."}
		try{
			spec = JSON.parse(specString)
		}catch(e){throw "The block's spec is malformed. Please file an issue with the block maintainer."}
		while(1){
				let configString, config, configStatus, statusColor, cont, mode, validation;
				try{
						statusColor = '\x1b[33m' //Yellow
						configStatus = 'missing'
						configString = fs.readFileSync(configPath(b),{encoding:'utf8'})
						statusColor = '\x1b[31m' //Red
						configStatus = 'malformed'
						config = CSON.parse(configString)
						configStatus = 'invalid'
						validation = jsonValidate(config, {schema:spec.schema})
						if(!validation.valid){throw {message:validation.errors.join('/n')}}
						statusColor = '\x1b[32m' //green
						configStatus = 'ok'
					}catch(e){console.error(e.message)}
				console.info(statusColor + "Your block configuration is " + configStatus+"\x1b[0m")
				try{
				if(config){console.log(config)}
				if(configStatus == 'ok' && !options.silent){
						cont = (await prompt.getp([{
								description:"Continue with the above config? (Yes/no)",
								type:"string",
								pattern:/yes|no|y|n/i,
								message:"Yes or no required."
							}])).question.slice(0,1).toLowerCase()=='y'
						if(cont){ break; }
					}
				prompt.start()
				mode = (await prompt.getp({
						description:"Specify config via (w)eb UI or (c)ommand line, or (a)bort?",
						type:"string",
						pattern:/a(bort)?|w(eb)?|c(li)?|c(ommand)?/i,
						message:"Allowed values: a / w / c"
					})).question.slice(0,1).toLowerCase()
				}catch(e){throw "Quitting from prompt"}
				if(mode=='a'){process.exit(0)}
				if(mode=='c'){config = await prompt.getp(spec.schema)}
				if(mode=='w'){config = await webUI(b,spec)}
				fs.writeFileSync(configPath(b),JSON.stringify(config,undefined,2))
			}
		return true;
	}
async function compile(b){
		try{
				const config = CSON.parse(fs.readFileSync(configPath(b),{encoding:'utf8'}))
			}catch(e){
				console.error("Unexpected error reading config file during compile step. This should have been caught in earlier validation step")
			}
		const tFiles=glob.sync(templateGlob(b),globOptions)
		if(!tFiles.length){console.warn("Warning: No template files were found.")}
		tFiles.forEach(function(t){
				const tFile=fs.readFileSync(t,{encoding:'utf8'})
				var template
				try{
						template = dot.template(tFile);
					}catch(e){
						console.error("Error compiling template file "+t)
						console.error(e.message||e);
						throw "Unable to compile block template files. Please file an issue with the block maintainer"
					}
				try{
						output = template(config)
					}catch(e){
						console.error("Error applying template file "+t)
						console.error(e.message||e)
						throw "Please check your config or file an issue with the block maintainer"
					}
				writeFileSyncPlusPath(
						path.join(outputPath,path.basename(t).replace(/\.dot$/i,''))
						,output
					)
			})
			return;

			function writeFileSyncPlusPath(outpath, output){
					outpath.split('/').slice(0,-1).reduce(function(accum,x,i){
							accum.push(x); const path=accum.join('/')
							//e.g. for a/b/c.txt => path: "a","a/b"
							//e.g. for /a/b/c.txt => path: "", "/a", "/a/b"
							if(path && !fs.existsSync(path)){fs.mkdirSync(path)}
							return accum;
						},[])
					fs.writeFileSync(outpath,output);
				}
	}

var restify, server;
async function webUI(b,spec){
		return new Promise(function(resolve,reject){
				restify = restify || require('restify')
				server = server || restify.createServer({
						name: 'myapp',
						version: '1.0.0'
					})
				server.get( "/", restify.plugins.serveStatic({
						directory: path.join(__dirname,'./static'),
						default:"index.html"
					}))
				server.get( "/schema.json",(req,res)=>res.send(spec))
				/* I prefer CDNs
				server.get("/modules/jsoneditor",restify.serveStatic("node_modules/json-editor/dist"))
				server.get("/modules/jquery",restify.serveStatic("node_modules/jquery/dist"))
				server.get("/modules/font-awesome",restify.serveStatic("node_modules/font-awesome/css"))
				*/

				//server.use(restify.plugins.acceptParser(server.acceptable))
				server.use(restify.plugins.bodyParser())
				server.post("/submit",(req,res)=>{
						try{
								var validation = jsonValidate(req.body, {schema:spec.schema})
								if(!validation.valid){
										res.send(400,validation.errors)
									}else{
										res.send(200,{message:"Config received. Please return to command line to confirm."})
										console.log("Config received.")
										resolve(req.body)
									}
							}catch(e){
								console.error("Error while receiving config from web UI:",e.message)
								res.send(500)
							}
					})
				server.listen(30018, function() {
						console.log('http://localhost:30018/')
					})
					})
	}

function toASCIICamelCase(str) {
		return str.trim()
				.replace(/[^-_ a-z0-9]/ig,'')
				.replace(/[-_ ]+/g,'-')
				.replace(/-[a-z]/ig, match=>match.slice(1).toUpperCase())
	}
function camelToHyphen(str){
		return str.replace(/[A-Z]/,match=>"-"+match.toLowerCase())
	}
