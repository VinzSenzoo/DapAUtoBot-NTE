import axios from 'axios';
import cfonts from 'cfonts';
import gradient from 'gradient-string';
import chalk, { chalkStderr } from 'chalk';
import fs from 'fs/promises';
import readline from 'readline';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import ProgressBar from 'progress';
import ora from 'ora';
import boxen from 'boxen';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const logger = {
  info: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || 'ℹ️  ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.green('INFO');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  },
  warn: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || '⚠️ ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.yellow('WARN');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  },
  error: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || '❌ ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.red('ERROR');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  },
  debug: (msg, options = {}) => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emoji = options.emoji || '🔍  ';
    const context = options.context ? `[${options.context}] ` : '';
    const level = chalk.blue('DEBUG');
    const formattedMsg = `[ ${chalk.gray(timestamp)} ] ${emoji}${level} ${chalk.white(context.padEnd(20))}${chalk.white(msg)}`;
    console.log(formattedMsg);
  }
};

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

function centerText(text, width) {
  const cleanText = stripAnsi(text);
  const textLength = cleanText.length;
  const totalPadding = Math.max(0, width - textLength);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return `${' '.repeat(leftPadding)}${text}${' '.repeat(rightPadding)}`;
}

function printHeader(title) {
  const width = 80;
  console.log(gradient.morning(`┬${'─'.repeat(width - 2)}┬`));
  console.log(gradient.morning(`│ ${title.padEnd(width - 4)} │`));
  console.log(gradient.morning(`┴${'─'.repeat(width - 2)}┴`));
}

function printInfo(label, value, context) {
  logger.info(`${label.padEnd(15)}: ${chalk.cyan(value)}`, { emoji: '📍 ', context });
}

function printProfileInfo(address, userId, totalPoints, context) {
  printHeader(`Profile Info ${context}`);
  printInfo('Address', address || 'N/A', context);
  printInfo('User ID', userId || 'N/A', context);
  printInfo('Total Points', totalPoints.toString(), context);
  console.log('\n');
}

async function formatTaskTable(tasks, context) {
  console.log('\n');
  logger.info('Task List:', { context, emoji: '📋 ' });
  console.log('\n');

  const spinner = ora('Rendering tasks...').start();
  await new Promise(resolve => setTimeout(resolve, 1000));
  spinner.stop();

  const header = chalk.cyanBright('+----------------------+----------+-------+---------+\n| Task Name            | Freq     | Point | Status  |\n+----------------------+----------+-------+---------+');
  const rows = tasks.map(task => {
    const displayName = task.description && typeof task.description === 'string'
      ? (task.description.length > 20 ? task.description.slice(0, 17) + '...' : task.description)
      : 'Unknown Task';
    const status = task.user_completion !== null ? chalk.greenBright('Complte') : chalk.yellowBright('Pending');
    return `| ${displayName.padEnd(20)} | ${((task.frequency || 'N/A') + '     ').slice(0, 8)} | ${((task.points || 0).toString() + '    ').slice(0, 5)} | ${status.padEnd(6)} |`;
  }).join('\n');
  const footer = chalk.cyanBright('+----------------------+----------+-------+---------+');

  console.log(header + '\n' + rows + '\n' + footer);
  console.log('\n');
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/102.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getAxiosConfig(proxy, token = null, additionalHeaders = {}) {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'connection': 'keep-alive',
    'user-agent': getRandomUserAgent(),
    'accept-encoding': 'gzip, deflate, br, zstd',
    ...additionalHeaders
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  const config = {
    headers,
    timeout: 60000
  };
  if (proxy) {
    config.httpsAgent = newAgent(proxy);
    config.proxy = false;
  }
  return config;
}

function newAgent(proxy) {
  if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    logger.warn(`Unsupported proxy: ${proxy}`);
    return null;
  }
}

async function requestWithRetry(method, url, payload = null, config = {}, retries = 3, backoff = 2000, context) {
  for (let i = 0; i < retries; i++) {
    try {
      let response;
      if (method.toLowerCase() === 'get') {
        response = await axios.get(url, config);
      } else if (method.toLowerCase() === 'post') {
        response = await axios.post(url, payload, config);
      } else {
        throw new Error(`Method ${method} not supported`);
      }
      return response;
    } catch (error) {
      if (error.response && error.response.status >= 500 && i < retries - 1) {
        logger.warn(`Retrying ${method.toUpperCase()} ${url} (${i + 1}/${retries}) due to server error`, { emoji: '🔄', context });
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      }
      if (i < retries - 1) {
        logger.warn(`Retrying ${method.toUpperCase()} ${url} (${i + 1}/${retries})`, { emoji: '🔄', context });
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      }
      throw error;
    }
  }
}

async function readPKs() {
  try {
    const data = await fs.readFile('pk.txt', 'utf-8');
    const pks = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    logger.info(`Loaded ${pks.length} private key${pks.length === 1 ? '' : 's'}`, { emoji: '🔑 ' });
    return pks;
  } catch (error) {
    logger.error(`Failed to read pk.txt: ${error.message}`, { emoji: '❌ ' });
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    const proxies = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (proxies.length === 0) {
      logger.warn('No proxies found. Proceeding without proxy.', { emoji: '⚠️ ' });
    } else {
      logger.info(`Loaded ${proxies.length} prox${proxies.length === 1 ? 'y' : 'ies'}`, { emoji: '🌐 ' });
    }
    return proxies;
  } catch (error) {
    logger.warn('proxy.txt not found.', { emoji: '⚠️ ' });
    return [];
  }
}

async function login(keypair, proxy, context) {
  const address = keypair.publicKey.toBase58();
  const url = 'https://api.dapcoin.xyz/api/auth/login';
  const payload = { wallet_address: address, ref: 'Z-WEZFT9', email: null, username: null };
  const config = getAxiosConfig(proxy);
  const spinner = ora({ text: 'Logging in...', spinner: 'dots' }).start();
  try {
    const response = await requestWithRetry('post', url, payload, config, 3, 2000, context);
    if (response.data.token) {
      spinner.succeed(chalk.bold.greenBright(` Login Successfully`));
      console.log('\n');
      return response.data.token;
    } else if (response.data.nonce) {
      const message = new TextEncoder().encode(response.data.nonce);
      const signature = nacl.sign.detached(message, keypair.secretKey);
      const signatureBase64 = Buffer.from(signature).toString('base64');
      const verifyUrl = 'https://api.dapcoin.xyz/api/auth/verify';
      const verifyPayload = { signature: signatureBase64, wallet_address: address };
      const verifyResponse = await requestWithRetry('post', verifyUrl, verifyPayload, config, 3, 2000, context);
      spinner.succeed(chalk.bold.greenBright(` Login Successfully`));
      console.log('\n');
      return verifyResponse.data.token;
    } else {
      throw new Error('Unexpected response: neither token nor nonce received');
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Login failed: ${error.message}`));
    console.log('\n');
    throw new Error(`Failed to login: ${error.message}`);
  }
}

async function dailyCheckin(token, proxy, context) {
  logger.info('Starting daily check-in process...', { emoji: '📅 ', context });
  const url = 'https://api.dapcoin.xyz/api/checkin';
  const config = getAxiosConfig(proxy, token);
  config.validateStatus = (status) => status >= 200 && status < 500;
  const spinner = ora({ text: 'Performing daily check-in...', spinner: 'dots' }).start();
  try {
    const response = await requestWithRetry('post', url, null, config, 3, 2000, context);
    if (response.data.message === 'Checked in') {
      spinner.succeed(chalk.bold.greenBright(` Checked in successfully - Points awarded: ${response.data.points_awarded}`));
      return { success: true, message: `Checked in successfully - Points awarded: ${response.data.points_awarded}` };
    } else {
      spinner.warn(chalk.bold.yellowBright(` ${response.data.message}`));
      return { success: false, message: response.data.message };
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Daily check-in failed: ${error.message}`));
    return { success: false, message: `Failed: ${error.message}` };
  }
}

async function fetchActiveTasks(token, proxy, context) {
  const urls = [
    'https://api.dapcoin.xyz/api/tasks?limit=10000&frequency=ONCE',
    'https://api.dapcoin.xyz/api/tasks?limit=10&frequency=DAILY'
  ];
  let allTasks = [];
  const spinner = ora({ text: 'Fetching active tasks...', spinner: 'dots' }).start();
  try {
    for (const url of urls) {
      const config = getAxiosConfig(proxy, token);
      const response = await requestWithRetry('get', url, null, config, 3, 2000, context);
      allTasks = allTasks.concat(response.data.data);
    }
    spinner.stop();
    return allTasks;
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Failed to fetch active tasks: ${error.message}`));
    return [];
  }
}

async function completeTask(token, taskId, taskDescription, proxy, context) {
  const taskContext = `${context}|T${taskId.slice(-6)}`;
  const url = `https://api.dapcoin.xyz/api/tasks/${taskId}/complete`;
  const config = getAxiosConfig(proxy, token);
  config.validateStatus = (status) => status >= 200 && status < 500;
  const spinner = ora({ text: `Completing ${taskDescription}...`, spinner: 'dots' }).start();
  try {
    const response = await requestWithRetry('post', url, null, config, 3, 2000, taskContext);
    if (response.data.status === 'APPROVED') {
      spinner.succeed(chalk.bold.greenBright(` Completed: ${taskDescription}`));
      return { success: true, message: `Completed: ${taskDescription}` };
    } else {
      spinner.warn(chalk.bold.yellowBright(` Failed to complete ${taskDescription}`));
      return { success: false, message: `Failed to complete ${taskDescription}` };
    }
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Failed to complete ${taskDescription}: ${error.message}`));
    return { success: false, message: `Failed: ${error.message}` };
  }
}

async function fetchProfileInfo(token, proxy, context) {
  const url = 'https://api.dapcoin.xyz/api/me';
  const config = getAxiosConfig(proxy, token);
  const spinner = ora({ text: 'Fetching profile info...', spinner: 'dots' }).start();
  try {
    const response = await requestWithRetry('get', url, null, config, 3, 2000, context);
    spinner.stop();
    return {
      address: response.data.wallet_address,
      userId: response.data.id,
      totalPoints: response.data.points
    };
  } catch (error) {
    spinner.fail(chalk.bold.redBright(` Failed to fetch profile info: ${error.message}`));
    return null;
  }
}

async function processAccount(pk, index, total, proxy) {
  const context = `Account ${index + 1}/${total}`;
  logger.info(chalk.bold.magentaBright(`Starting account processing`), { emoji: '🚀 ', context });

  let keypair;
  try {
    keypair = Keypair.fromSecretKey(bs58.decode(pk));
  } catch (error) {
    logger.error(`Invalid private key: ${error.message}`, { emoji: '❌ ', context });
    return;
  }
  const address = keypair.publicKey.toBase58();

  printHeader(`Account Info ${context}`);
  printInfo('Address', address, context);
  const ip = await getPublicIP(proxy, context);
  printInfo('IP', ip, context);
  console.log('\n');

  try {
    const token = await login(keypair, proxy, context);

    await dailyCheckin(token, proxy, context);
    console.log('\n');
    logger.info('Starting tasks processing...', { emoji: '📋 ', context });
    
    const activeTasks = await fetchActiveTasks(token, proxy, context);
    const pendingTasks = activeTasks.filter(task => task.user_completion === null);

    if (pendingTasks.length === 0) {
      logger.info('No tasks ready to complete', { emoji: '⚠️ ', context });
    } else {
      console.log();
      const bar = new ProgressBar('Processing tasks [:bar] :percent :etas', {
        complete: '█',
        incomplete: '░',
        width: 30,
        total: pendingTasks.length
      });

      let completedCount = 0;

      for (const task of pendingTasks) {
        try {
          const result = await completeTask(token, task.id, task.description || 'Unknown Task', proxy, context);
          if (result.success) {
            completedCount++;
          }
        } catch (error) {
          logger.error(`Error completing task ${task.id}: ${error.message}`, { context });
        }
        bar.tick();
        await delay(2);
      }
      console.log();
      logger.info(`Processed ${pendingTasks.length} Tasks: ${completedCount} Completed`, { emoji: '📊 ', context });
    }

    await formatTaskTable(activeTasks, context);

    const updatedProfileInfo = await fetchProfileInfo(token, proxy, context);
    if (updatedProfileInfo) {
      printProfileInfo(updatedProfileInfo.address, updatedProfileInfo.userId, updatedProfileInfo.totalPoints, context);
    } else {
      logger.warn('Failed to display updated profile info', { emoji: '⚠️', context });
    }

    logger.info(chalk.bold.greenBright(`Completed account processing`), { emoji: '🎉 ', context });
    console.log(chalk.cyanBright('________________________________________________________________________________'));
  } catch (error) {
    logger.error(`Error processing account: ${error.message}`, { emoji: '❌ ', context });
  }
}

async function getPublicIP(proxy, context) {
  try {
    const config = getAxiosConfig(proxy);
    const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, config, 3, 2000, context);
    return response.data.ip || 'Unknown';
  } catch (error) {
    logger.error(`Failed to get IP: ${error.message}`, { emoji: '❌ ', context });
    return 'Error retrieving IP';
  }
}

let globalUseProxy = false;
let globalProxies = [];

async function initializeConfig() {
  const useProxyAns = await askQuestion(chalk.cyanBright('🔌 Do You Want to Use Proxy? (y/n): '));
  if (useProxyAns.trim().toLowerCase() === 'y') {
    globalUseProxy = true;
    globalProxies = await readProxies();
    if (globalProxies.length === 0) {
      globalUseProxy = false;
      logger.warn('No proxies available, proceeding without proxy.', { emoji: '⚠️ ' });
    }
  } else {
    logger.info('Proceeding without proxy.', { emoji: 'ℹ️ ' });
  }
}

async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function runCycle() {
  const pks = await readPKs();
  if (pks.length === 0) {
    logger.error('No private keys found in pk.txt. Exiting cycle.', { emoji: '❌ ' });
    return;
  }

  for (let i = 0; i < pks.length; i++) {
    const proxy = globalUseProxy ? globalProxies[i % globalProxies.length] : null;
    try {
      await processAccount(pks[i], i, pks.length, proxy);
    } catch (error) {
      logger.error(`Error processing account: ${error.message}`, { emoji: '❌ ', context: `Account ${i + 1}/${pks.length}` });
    }
    if (i < pks.length - 1) {
      console.log('\n\n');
    }
    await delay(5);
  }
}

async function run() {
  const terminalWidth = process.stdout.columns || 80;
  cfonts.say('NT EXHAUST', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'magenta'],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true
  });
  console.log(gradient.retro(centerText('=== Telegram Channel 🚀 : NT Exhaust (@NTExhaust) ===', terminalWidth)));
  console.log(gradient.retro(centerText('✪ DAPCOIN AUTO DAILY BOT ✪', terminalWidth)));
  console.log('\n');
  await initializeConfig();

  while (true) {
    await runCycle();
    console.log();
    logger.info(chalk.bold.yellowBright('Cycle completed. Waiting 24 hours...'), { emoji: '🔄 ' });
    await delay(86400);
  }
}

run().catch(error => logger.error(`Fatal error: ${error.message}`, { emoji: '❌' }));