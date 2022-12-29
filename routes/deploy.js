/*
    deploy.js
    Methods for project deployment
*/

const storage = require("../utils/storage");
const auth = require("../utils/auth");
const fs = require('fs');
const home_dir = `${require('os').homedir()}`;

module.exports = function (app) {

    //Handles Webhooks from Git repository
    //Now only Bitbucket repositories are supported
    app.post('/deploy/:api_token', async function (req, res) {

        //Git services doesn't send any custom headers that's why we can use only api_token in URL and add it to headers here
        req.headers["api-token"]= req.params.api_token;
        if (await auth.validate_token(req.headers) == false){
            res.statusCode = 401;
            res.end(JSON.stringify({ error: "Invalid api key" }));
            return;
        }

        if (req.body.repository == undefined) {
            res.statusCode = 403;
            res.end("");
            return;
        }

        const repo_name = req.body.repository.name;
        const repo_full_name = req.body.repository.full_name;
        const updated_branch = req.body.push.changes[0].new.name;

        console.log(repo_name + " " + updated_branch);

        //Update projects
        let service = global.projects.find(service => service.full_name === repo_full_name);
        if (service != undefined) {
            var environment = service.environments.find(environment => environment.branch === updated_branch);
            if (environment != undefined) {
                environment.status = "to_deploy";
                storage.save_services();
            }
        }
        res.statusCode = 200;
        res.end(JSON.stringify({}));
    });

    app.get('/deploy/credentials', async function (req, res) {
        const ssh_pub_key = fs.readFileSync(home_dir + '/.ssh/id_rsa.pub', 'utf8');
        const credentials = {"ssh_pub_key":ssh_pub_key,"webhook_url":`https://${global.service_node_config.domain}/deploy/${global.service_node_config.api_token}`}
        res.writeHead(200, {
            'Content-Type': 'application/json'
          });
        res.end(JSON.stringify(credentials));
    });

}