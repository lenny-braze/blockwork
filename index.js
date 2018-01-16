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

var Promise = bb


const blookstoreIndex={
		"redshift-admin":"fabio-looker/blook-redshift-admin"
	}
const downloadPath = "./.blooker-tmp/"
const templateGlob = "./.blooker-tmp/*.dot"
const schemaPath =   "./.blooker-tmp/blook.json"
const configPath = "blookmark.cson" 
const globOptions = {}
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
		var blookName;
		var argOffset
		if(process.argv[0].match(/blooker/)){argOffset=1} //e.g. blooker foo
		if(process.argv[0].match(/node/)){argOffset=2} //e.g. node index.js foo
		if(argOffset===undefined){
				throw "Unexpected usage of script. Please report your use case to https://github.com/fabio-looker/blooker/issues"
			}
		const cliArgs = getCliArgs(process.argv.slice(argOffset))
		const command = cliArgs._[0]
		switch (command){
			case "install":
					blookName = cliArgs._[1]
					await fetch(blookName)
					await config()
					await compile()
				break;
			case "fetch":
					blookName = cliArgs._[1]
					await fetch(blookname);
				break;
			case "config":
					await config()
				break;
			case "compile":
					await config()
				break;
			default: 
					console.warn("Missing or unknown command. Try `blooker install foo`")
				break;
		}
		}catch(e){console.error(e)}
		process.exit(0)
	}
	
async function fetch(blookName){
				if(!blookName){throw "Block name required."}
				const blook = blookstoreIndex[blookName]
				if(!blook){throw "No registered block with the name " + blookName}
				await download(blook, downloadPath)
				return true
	}
async function config(){
		var schemaString, schema, configString, config, configStatus, statusColor, validation, cont, mode;
		try{
			schemaString = fs.readFileSync(schemaPath,{encoding:'utf8'})
		}catch(e){throw "Blook does not have a schema"}
		try{
			schema = JSON.parse(schemaString)
		}catch(e){throw "Blook schema is malformed"}
		while(1){
				try{
						statusColor = '\x1b[31m'
						configStatus = 'missing'
						configString = fs.readFileSync(configPath,{encoding:'utf8'})
						configStatus = 'malformed'
						config = CSON.parse(configString)
						configStatus = 'invalid'
						validation = jsonValidate(config, schema)
						if(!validation.valid){throw {message:validation.errors.join('/n')}}
						statusColor = '\x1b[32m' //green
						configStatus = 'ok'
					}catch(e){console.error(e.message)}
				console.info(statusColor + "Blook configuration is " + configStatus+"!\x1b[0m")
				try{
				console.log(config)
				if( configStatus == 'ok'){
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
				if(mode=='c'){config = await prompt.getp(schema.schema)}
				if(mode=='w'){config = await webUI(schema)}	
				fs.writeFileSync(configPath,JSON.stringify(config,undefined,2))
			}
		return true;
	}
async function compile(){
	const templateFiles=glob.sync(templateGlob,globOptions)
	console.log("CONTINUE...")
	return templateFiles
	}

var restify, server;
async function webUI(schema){
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
				server.get( "/schema.json",(req,res)=>res.send(schema))
				/* I prefer CDNs
				server.get("/modules/jsoneditor",restify.serveStatic("node_modules/json-editor/dist"))
				server.get("/modules/jquery",restify.serveStatic("node_modules/jquery/dist"))
				server.get("/modules/font-awesome",restify.serveStatic("node_modules/font-awesome/css"))
				*/
				
				//server.use(restify.plugins.acceptParser(server.acceptable))
				server.use(restify.plugins.bodyParser())
				server.post("/submit",(req,res)=>{
						try{
								var validation = jsonValidate(req.body, schema)
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
	
