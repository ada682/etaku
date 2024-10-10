const fs = require("fs").promises;
const axios = require("axios");
const path = require("path");
const WebSocket = require('ws');
const logger = require("./config/logger.js");

class EtakuGame {
  constructor() {
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://etaku-storage.sgp1.cdn.digitaloceanspaces.com',
      'Referer': 'https://etaku-storage.sgp1.cdn.digitaloceanspaces.com/',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'sec-ch-ua': '"Chromium";v="129", "Not=A?Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'priority': 'u=4, i'
    };
    this.apiUrl = "https://api.etaku.ai";
    this.wsUrl = "wss://api.etaku.ai/ws";
    this.gameState = null;
    this.tapCount = 0;
    this.lastTapTime = 0;
    this.token = null;
  }

  async login(telegramQueryString) {
    try {
      const response = await axios.post(`${this.apiUrl}/v1/auth/login/telegram`, {
        data: telegramQueryString
      }, {
        headers: this.headers
      });
      this.token = response.data.data.accessToken;
      return response.data.data;
    } catch (error) {
      logger.error(`Login failed: ${error.message}`);
      throw error;
    }
  }

  connectWebSocket(token) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}?token=${token}`);
      
      ws.on('open', () => {
        logger.info('WS connected');
        this.sendGameMessage(ws, 3, null);  
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data);
        this.handleGameMessage(ws, message);
      });

      ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
        reject(error);
      });

      resolve(ws);
    });
  }

  handleGameMessage(ws, message) {
    switch(message.msg_type) {
      case 1:  
        this.sendGameMessage(ws, 4, null);  
        break;
      case 6:  
        if (message.data.success) {
          this.tapCount++;
          if (this.tapCount % 10 === 0) { 
            logger.info(`Tap successful! Total taps: ${this.tapCount}`);
          }
        }
        break;
      case 10:  
        const oldState = this.gameState;
        this.gameState = message.data;
        
        if (oldState) {
          const coinDiff = this.gameState.ECoin - oldState.ECoin;
          const powerDiff = this.gameState.CurrentPower - oldState.CurrentPower;
          logger.info(`State Update - ECoin: ${this.gameState.ECoin} (${coinDiff >= 0 ? '+' : ''}${coinDiff}), Power: ${this.gameState.CurrentPower} (${powerDiff >= 0 ? '+' : ''}${powerDiff})`);
        } else {
          logger.info(`Initial State - ECoin: ${this.gameState.ECoin}, Power: ${this.gameState.CurrentPower}`);
        }
        break;
    }
  }

  sendGameMessage(ws, msgType, data = null) {
    const message = {
      msg_type: msgType,
      data: data
    };
    ws.send(JSON.stringify(message));
  }

  async autoTap(ws) {
    const TAP_INTERVAL = 100; 
    const TAP_DURATION = 300000; 
    const BATCH_SIZE = 5; 

    return new Promise((resolve) => {
      const tapInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const now = Date.now();
          if (now - this.lastTapTime >= TAP_INTERVAL) {
            this.sendGameMessage(ws, 1, null);
            
            for (let i = 0; i < BATCH_SIZE; i++) {
              setTimeout(() => {
                this.sendGameMessage(ws, 12, null);
              }, i * 20); 
            }
            
            this.lastTapTime = now;
          }
        }
      }, TAP_INTERVAL);

      setTimeout(() => {
        clearInterval(tapInterval);
        logger.info(`Auto-tap completed. Total taps: ${this.tapCount}`);
        resolve();
      }, TAP_DURATION);
    });
  }

  async processAccount(queryString) {
    try {
      logger.info("Processing account...");
      const loginData = await this.login(queryString);
      logger.info(`Logged in as ${loginData.username}`);
      
      const ws = await this.connectWebSocket(loginData.accessToken);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      this.tapCount = 0;
      logger.info("Starting auto-tap...");
      await this.autoTap(ws);
      
      if (this.gameState) {
        logger.info(`Final state - ECoin: ${this.gameState.ECoin}, Power: ${this.gameState.CurrentPower}, Total taps: ${this.tapCount}`);
      }
      
      ws.close();
    } catch (error) {
      logger.error(`Failed to process account: ${error.message}`);
    }
  }

  async main() {
    try {
      const dataPath = path.join(__dirname, 'data.txt');
      const queryString = await fs.readFile(dataPath, 'utf8');
      
      if (!queryString) {
        logger.error("No data provided in data.txt.");
        process.exit(1);
      }

      await this.processAccount(queryString.trim());

      logger.info("Account processed");
      process.exit(0);
    } catch (error) {
      logger.error(`Main error: ${error.message}`);
      process.exit(1);
    }
  }
}

const game = new EtakuGame();
game.main();
