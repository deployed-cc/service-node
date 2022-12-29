/*
    vpn.js
    Methods to manage VPN
*/

const adm_zip = require('adm-zip');
const os = require('os');
const home_dir = `${os.homedir()}`;
const crypto = require('crypto');
const fs = require('fs')
const exec = require('child_process').exec;
const storage = require("../utils/storage");

module.exports = function (app) {

  //Add a new node to VPN
  //This request can be send only to localhost (for example, if you use Deploy CLI on the same server where you keep your vpn private key)
  //or from any node within VPN
  app.post('/vpn_node', async function (req, res) {

    const name = req.body.name;
    if (global.service_node_config.vpn_nodes.find(node => node.name === name) != undefined) {
      res.statusCode = 403;
      res.end(JSON.stringify({ "msg": `The node with name ${name} already exists. Use another name.` }));
      return;
    }

    const archive_uuid = crypto.randomUUID();
    global.logger.info(`Adding new VPN node ${name}`);

    //Generate .crt and .key for a new node
    //Keep available IPs in ~/.deployed-config.json and take IP from this IP list only
    //We should add IP of a removed node to this list again

    //Generate a new VPN private IP
    const private_ip_mask = `192.168.202.`;
    const IP_mask_min = 2;
    const IP_mask_max = 254;
    var random_id = randomNumber(IP_mask_min,IP_mask_max);
    while (global.service_node_config.vpn_nodes.find(node => node.ip === `${private_ip_mask}${random_id}`) != undefined) {
      random_id = randomNumber(IP_mask_min,IP_mask_max);
    }

    var new_vpn_node = {};
    new_vpn_node.ip = `${private_ip_mask}${random_id}`;
    new_vpn_node.name = name;

    global.logger.info(`Random private VPN IP: ${new_vpn_node.ip}`);

    exec(`./nebula-cert sign -name \"${new_vpn_node.name}\" -ip \"${new_vpn_node.ip}\/24" -groups "devs" && sudo ufw allow from ${new_vpn_node.ip}`,{
      cwd: home_dir
  }, function (err, stdout, stderr) {

      if (err != null) {
        res.statusCode = 403;
        res.end(JSON.stringify({ "msg": `Cannot generate a certificate for a new node. Error: ${err}` }));
        return;
      }

      global.service_node_config.vpn_nodes.push(new_vpn_node);
      storage.save_config();

      global.logger.info(`A certificate for a new node is created.`);

      //After we generate certificates for a new node move them to folder $HOME/$archive_uuid
      //We need 4 files: ca.crt, config.yaml, host.key, host.crt
      const archive_root = `${home_dir}/${archive_uuid}`;
      if (!fs.existsSync(archive_root)) {
        fs.mkdirSync(archive_root, { recursive: true });
      }

      fs.copyFileSync(`${home_dir}/ca.crt`, `${archive_root}/ca.crt`);
      fs.copyFileSync(`${home_dir}/node_config.yaml`, `${archive_root}/config.yaml`);
      fs.copyFileSync(`${home_dir}/${name}.crt`, `${archive_root}/host.crt`);
      fs.copyFileSync(`${home_dir}/${name}.key`, `${archive_root}/host.key`);

      //Generate ZIP from $HOME/$archive_uuid
      const zip = new adm_zip();
      zip.addLocalFile(`${archive_root}/ca.crt`);
      zip.addLocalFile(`${archive_root}/config.yaml`);
      zip.addLocalFile(`${archive_root}/host.crt`);
      zip.addLocalFile(`${archive_root}/host.key`);

      // Define zip file name
      const download_name = `deployed-cc-vpn-setup-${archive_uuid}.zip`;
      zip.writeZip(`${home_dir}/${download_name}`);

      try {

        //Remove crt and key files of this new node and a folder used to create a zip archive
        fs.unlinkSync(`${home_dir}/${name}.crt`)
        fs.unlinkSync(`${home_dir}/${name}.key`)
        fs.rmSync(archive_root, { recursive: true, force: true });

      } catch (err) {
        global.logger.error(`Cannot remove file: ${err}`);
      }

      res.statusCode = 201;
      res.end(JSON.stringify(`

Service Node Agent has been installed.

To deploy a first project you should:

- install Deploy CLI on your local machine (on your laptop, iMac, Desktop computer etc.). Run in Terminal/Console (NPM should be installed on your system):
      
    npm install -g deployed

- check that Deployed CLI is installed:

    deploy -v

Note: If you see a message like 'command not found: deploy' try to install Deployed CLI with sudo: 'sudo npm install -g deployed' 
      
- connect your local machine to a virtual private network (this server is already in this network). Run in Terminal/Console on your local machine:

    deploy -j https://${global.service_node_config.domain}/join_vpn/${archive_uuid}
      
If everything goes well you'll see menu with 2 items:

    - Add service
    - Manage services
      
Select Add service and follow instructions to deploy your first project.

`));

    });

  });

  app.get('/join_vpn/:archive_uuid', async function (req, res) {

    const archive_uuid = req.params.archive_uuid;
    const download_file = `${home_dir}/deployed-cc-vpn-setup-${archive_uuid}.zip`;
    if (!fs.existsSync(download_file)) {
      res.statusCode = 404;
      res.end("The setup archive isn't found! You can download an archive only once. Try to add a new VPN node again.");
      return;
    }

    var zip = new adm_zip(download_file);
    const data = zip.toBuffer();
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename=deployed-cc-setup-vpn.zip`, 'Content-Length': data.length });
    res.end(data);

    try {
      fs.unlinkSync(download_file)
    } catch (err) {
      global.logger.error(`Cannot remove zip at ${download_file}: ${err}`);
    }
  });

}

function randomNumber(min, max) { 
  return Math.floor(Math.random() * (max - min) + min);
} 
