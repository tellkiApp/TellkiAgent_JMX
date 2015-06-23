/**
 * This script was developed by Guberni and is part of Tellki's Monitoring Solution
 *
 * June, 2015
 * 
 * Version 1.0
 *
 * DEPENDENCIES:
 *		jmxterm (http://wiki.cyclopsgroup.org/jmxterm/)
 *
 * DESCRIPTION: Monitor JMX metrics
 *
 * SYNTAX: node jmx_monitor.js <HOST> <PORT> <METRICS> <METRIC_STATE> <USERNAME> <PASSWORD>
 * 
 * EXAMPLE: node "jmx_monitor.js" "localhost" "1099" "1127,4,m1,org.apache.activemq:brokerName=localhost,type=Broker AverageMessageSize,0" "1,1,1" "username" "password"
 *
 * README:
 *		<HOST> hostname or ip where JMX is listening
 *
 *		<PORT> port where JMX is listening
 *
 *		<METRICS> custom metrics list, separated by ";" and each one have 5 fields separeted by "," and it contains the metric definition.
 *
 *		<METRIC_STATE> is generated internally by Tellki and it's only used by Tellki default monitors (1 - metric is on ; 0 - metric is off).
 *
 *		<USERNAME> JMX auth username
 *
 *		<PASSWORD> JMX auth password
 */

var exec = require('child_process').exec;

var ExecTemplates = {
	Cmd : "echo get -s -b {MBEAN} | java -jar jmxterm.jar -l {HOSTNAME}:{PORT} -v silent -n",
	CmdAuth : "echo get -s -b {MBEAN} | java -jar jmxterm.jar -l {HOSTNAME}:{PORT} -v silent -n -u {USERNAME} -p {PASSWORD}",
	CmdDomain : "echo get -s -d {DOMAIN} -b {MBEAN} | java -jar jmxterm.jar -l {HOSTNAME}:{PORT} -v silent -n",
	CmdDomainAuth : "echo get -s -d {DOMAIN} -b {MBEAN} | java -jar jmxterm.jar -l {HOSTNAME}:{PORT} -v silent -n -u {USERNAME} -p {PASSWORD}"
};

/**
 * Entry point
 */
(function() {
	try
	{
		monitorInput(process.argv.slice(2));
	}
	catch (err)
	{	
		if (err instanceof InvalidParametersNumberError)
		{
			console.log(err.message);
			process.exit(err.code);
		}
		else
		{
			console.log(err.message);
			process.exit(1);
		}
	}
}).call(this)


/**
 * Verify number of passed arguments into the script.
 */
function monitorInput(args)
{
	if (args.length != 6)
	{
		throw new InvalidParametersNumberError();
	}		

	monitorInputProcess(args);
}


/*
* Process the passed arguments and send them to monitor execution (monitorICMP)
* Receive: arguments to be processed
*/
function monitorInputProcess(args)
{
	var cleanArgs = [];
	for (var k = 0; k < args.length; k++)
		cleanArgs.push(args[k].replace(/\"/g, ''));
	
	//<HOST> 
	var hostname = args[0];
	
	//<PORT>
	var port = args[1];
		
	//<METRICS> 
	var metrics = cleanArgs[2].split(";");

	//<METRIC_STATE> 
	var metricState = cleanArgs[3].split(",");

	// <USERNAME>
	var username = cleanArgs[4];
	username = (username === '') ? null : username;

	// <PASSWORD>
	var password = cleanArgs[5];
	password = (password === '') ? null : password;
		
	// Create snmp target object.
	var jmxServer = new Object();
	jmxServer.hostname = hostname;
	jmxServer.port = port;
	jmxServer.username = username;
	jmxServer.password = password;
	
	// Create metrics to retrieve.
	var metricsToMonitor = [];
	
	for (var j = 0; j < metrics.length; j++)
	{
		if (endsWith(metrics[j], ',0'))
			metrics[j] = metrics[j].slice(0, metrics[j].length - 2);
		var metricparam = metrics[j].split(',');
		
		var metricID = metricparam.shift();
		var metricType = metricparam.shift();
		var metricName = metricparam.shift();
		var metricDomain = null;
		var metricMBean = metricparam.join(',').replace(/\"/g, '');
		var metricAttrKey = null;

		if (metricMBean.indexOf(':') >= 0)
		{
			var tokens = metricMBean.split(':');
			if (tokens.length != 2)
				errorHandler(new MetricNotFoundError());

			metricDomain = tokens[0];
			metricMBean = tokens[1];
		}

		var attr = getAttributeKey(metricMBean);
		if (attr != null)
		{
			metricMBean = attr.mbean;
			metricAttrKey = attr.key;
		}

		metricsToMonitor.push({
			id : metricID,
			type : metricType,
			name : metricName,
			domain : metricDomain,
			mbean : replaceAllButLast(metricMBean, ' ', require('path').sep === '/' ? '\\\\ ' : '\\ '),
			attrKey : metricAttrKey,
			enable : metricState[j] === '1',
			value : ''
		});
	}
	
	// Call monitor.
	monitor(jmxServer, metricsToMonitor, 0);
}

function endsWith(str, suffix)
{
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

function replaceAllButLast(str, token, replaceToken)
{
	var p = [];
	var r = 0;
    while (true)
    {
		r = str.indexOf(' ', r);
		if (r === -1)
			break;
		p.push(r);
		r++;
    }

    if (p.length > 0)
    {
    	p.pop(); // Remove last.
    	for (var i = 0; i < p.length; i++)
    		str = str.replace(str.substring(p[i], p[i] + token.length), replaceToken);
    }

    return str;
}

function getAttributeKey(attr)
{
    var spaceFound = false, dotFound = false;
    for (var i = attr.length - 1; i >= 0; i--)
    {
        if (attr[i] === '.')
            dotFound = true;

        if (attr[i] === ' ')
            spaceFound = true;

        if (dotFound && !spaceFound)
        {
            // Key found.
            return {
                key: attr.slice(i + 1, attr.length),
                mbean: attr.slice(0, i)
            }
        }

        if (spaceFound)
            return null;
    }

    return null;
}

// ### MAIN

/**
 * Retrieve metrics information
 * Receive: 
 * - jmx target configuration
 * - metrics list 
 */
function monitor(jmxServer, metricsToMonitor, i)
{
	if (i < metricsToMonitor.length)
	{
		var metric = metricsToMonitor[i];
		if (metric.enable)
		{
			var cmd = createExecCmd(jmxServer, metric);
			exec(cmd, { timeout: 60000 }, function (error, stdout, stderr) {

				if (error !== undefined && error !== null && error !== '')
				{
					console.log(error);
					errorHandler(new MetricNotFoundError());
				}

				metric.value = stdout.trim();

				if (metric.value === '')
					errorHandler(new MetricNotFoundError());

				if (metric.attrKey !== null)
					metric.value = getKeyValue(metric.value, metric.attrKey);

				if (metric.value === null)
					errorHandler(new MetricNotFoundError());

				if (metric.value.indexOf('=') >= 0)
					errorHandler(new MetricNotFoundError());

				monitor(jmxServer, metricsToMonitor, i + 1); // Next metric.
			});
		}
		else
		{
			monitor(jmxServer, metricsToMonitor, i + 1); // Next metric.
		}
	}
	else
	{
		output(metricsToMonitor)
	}
}

function getKeyValue(value, attrKey)
{
	var lines = value.split(/\r?\n/);
	for (var i = 0; i < lines.length; i++)
	{
		var line = lines[i];
		if (line.indexOf(attrKey) >= 0)
		{
			var tokens = line.trim().split('=');
			if (tokens.length !== 2)
				return null;
		
			return tokens[1].trim().replace(';', '');
		}
	}

	return null;
}

function createExecCmd(jmxServer, metric)
{
	var cmdKey = 'Cmd' + (metric.domain === null ? '' : 'Domain') + (jmxServer.username === null ? '' : 'Auth');
	var cmd = ExecTemplates[cmdKey];

	cmd = cmd.replace(/{DOMAIN}/g, metric.domain);
	cmd = cmd.replace(/{MBEAN}/g, metric.mbean);
	cmd = cmd.replace(/{HOSTNAME}/g, jmxServer.hostname);
	cmd = cmd.replace(/{PORT}/g, jmxServer.port);
	cmd = cmd.replace(/{USERNAME}/g, jmxServer.username);
	cmd = cmd.replace(/{PASSWORD}/g, jmxServer.password);

	return cmd;
}

// ### OUTPUT

/**
 * Send metrics to console
 * Receive: metrics list to output
 */
function output(metrics)
{
	var out = "";
	
	for (var i in metrics)
	{
		var metric = metrics[i];
		
		if (metric.enable)
		{
			out += metric.id+":"+metric.name+":"+metric.type;
			out += "|";
			out += metric.value;
			out += "|";
				
			if(i < metrics.length-1)
			{
				out += "\n";
			}
		}
	}
	
	console.log(out);
}

// ### ERROR HANDLER

/**
 * Used to handle errors of async functions
 * Receive: Error/Exception
 */
function errorHandler(err)
{
	if(err instanceof RequestTimedOutError)
	{
		console.log(err.message);
		process.exit(err.code);
	}
	else if(err instanceof MetricNotFoundError)
	{
		console.log(err.message);
		process.exit(err.code);
	}
	else
	{
		console.log(err.message);
		process.exit(1);
	}
}

// ### EXCEPTIONS

// InvalidParametersNumberError
function InvalidParametersNumberError() {
    this.name = "InvalidParametersNumberError";
    this.message = "Wrong number of parameters.";
	this.code = 3;
}
InvalidParametersNumberError.prototype = Object.create(Error.prototype);
InvalidParametersNumberError.prototype.constructor = InvalidParametersNumberError;

// RequestTimedOutError
function RequestTimedOutError() {
    this.name = "RequestTimedOutError";
    this.message = "Timeout. Verify hostname/ipaddress and snmp settings.";
	this.code = 14;
}
RequestTimedOutError.prototype = Object.create(Error.prototype);
RequestTimedOutError.prototype.constructor = RequestTimedOutError;

// MetricNotFoundError
function MetricNotFoundError() {
    this.name = "MetricNotFoundError";
    this.message = "";
	this.code = 8;
}
MetricNotFoundError.prototype = Object.create(Error.prototype);
MetricNotFoundError.prototype.constructor = MetricNotFoundError;
