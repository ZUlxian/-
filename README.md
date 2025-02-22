# By-ZU_xian

做了一个通过局域网进行传输的微信小程序面对面传输，但是问题在于微信小程序的体量限制，只能使用最原始的UDP进行传输，而我做好了之后发现这个UDP传输放到小程序当中在2025年的今天显得太过于鸡肋，因为传输效率极其低下，发送一个大于10kb的文件可能就无法传输了，只能发送5kb左右的小文件，所以我打算放弃这个项目，因此里面有一些UI问题没有后续的解决。此代码拿出来开源，以供大学生进行学习！从代码中可以学习到一些关于蓝牙和UDP建立连接的东西，因为此代码开源靠一些营销号不要拿去骗实践大学生的钱！

使用说明：
1. 下载到pages和utils两个文件夹
2. 打开微信开发者工具，新建一个小程序，选择JS基础模板进行创建
3. 将pages和utils复制并粘贴到小程序的根目录进行替换就好了

# File Transfer Module

一个基于微信小程序的UDP局域网文件传输模块，可实现在局域网中进行文件传输。

## 代码预览

### 网络管理部分 // networkManager.js

```javascript
/* networkManager.js
 * @author ZU_xian
 * @copyright ZU_xian UDP file transfer WeChat applet
 * Created by ZU_xian (2025)
 * All rights reserved.
 */
class NetworkManager {
  constructor() {
      this.udp = null;
      this.transferUdp = null;
      this.discoveryPort = null;
      this.transferStates = new Map();
      this.transferPort = null;
      this.discoveryInterval = null;
      this.foundDevices = new Map();
      this.lanDevices = new Map();
      this.deviceId = this.generateDeviceId();
      this.isTransferring = false;
      this.currentChunks = new Map();
      this.ackTimeouts = new Map();
      this.retryCount = new Map();
      this.maxRetries = 3;
      this.chunkSize = 60000;
      this.ackTimeout = 1000;
      this.portRetryAttempts = 0;
      this.maxPortRetries = 10;
      this.startPort = 40000;
      this.isInitializing = false;
      this.initRetryCount = 0;
      this.maxInitRetries = 3;
      this.currentTransferId = null;
      this.currentFileInfo = null;
      this.processedTransfers = new Map();
      this.transferLocks = new Map();
      this.processedAcks = new Map();
      this.activeTransfers = new Set();
      this.lastProcessedFile = null;
      
      this.onProgress = null;
      this.onComplete = null;
      this.onError = null;
      this.onDeviceFound = null;
      this.onLANDeviceFound = null;
      this.onReceiveStart = null;
      this.onConnectionLost = null;
      this.onReceiveComplete = null;
      this.onPairRequest = null;  
      this.onPairResponse = null;
      this.onPairCancel = null; 
      this.onTransferStatusUpdate = null;
  }

  generateDeviceId() {
      return 'device_' + Math.random().toString(36).substr(2, 9);
  }

  resetTransferState() {
      this.isTransferring = false;
      this.currentChunks.clear();
      this.currentTransferId = null;
      this.currentFileInfo = null;
      
      this.ackTimeouts.forEach(timeout => clearTimeout(timeout));
      this.ackTimeouts.clear();
      this.retryCount.clear();
      
      this.activeTransfers.clear();
      this.processedAcks.clear();
  }

  static async getNetworkType() {
      return new Promise((resolve, reject) => {
          wx.getNetworkType({
              success: (res) => {
                  resolve({
                      type: res.networkType,
                      signalStrength: res.signalStrength || 0,
                      isWifi: res.networkType === 'wifi',
                      isStable: true
                  });
              },
              fail: reject
          });
      });
  }

  async initDiscovery() {
      if (this.isInitializing) {
          return false;
      }

      if (this.initRetryCount >= this.maxInitRetries) {
          return false;
      }
  
      this.isInitializing = true;
  
      try {
          this.cleanup();
  
          const discoveryPort = await this.bindAvailablePort();
          if (!discoveryPort) {
              throw new Error('无法找到可用的发现端口');
          }
  
          const transferPort = await this.bindAvailablePort(discoveryPort + 1000);
          if (!transferPort) {
              throw new Error('无法找到可用的传输端口');
          }
  
          this.udp = wx.createUDPSocket();
          const boundDiscoveryPort = this.udp.bind(discoveryPort);
          if (!boundDiscoveryPort) {
              throw new Error('绑定发现端口失败');
          }
          this.discoveryPort = boundDiscoveryPort;
          
          this.transferUdp = wx.createUDPSocket();
          const boundTransferPort = this.transferUdp.bind(transferPort);
          if (!boundTransferPort) {
              throw new Error('绑定传输端口失败');
          }
          this.transferPort = boundTransferPort;
  
          this.udp.onMessage((res) => {
              this.handleMessage(res);
          });
  
          this.transferUdp.onMessage((res) => {
              this.handleTransferMessage(res);
          });
  
          this.udp.onError((error) => {
              this.handleUDPError(error);
          });
  
          this.transferUdp.onError((error) => {
              this.handleUDPError(error);
          });
  
          await this.startDiscoveryBroadcast();
  
          this.isInitializing = false;
          this.initRetryCount = 0;
          return true;
  
      } catch (error) {
          this.isInitializing = false;
          this.initRetryCount++;
          this.cleanup();
          throw error;
      }
  }

  async initTransferSocket() {
      if (this.transferUdp) {
          try {
              this.transferUdp.close();
          } catch (e) {}
      }
      
      this.transferUdp = wx.createUDPSocket();
      const transferPort = await this.bindAvailablePort(this.startPort + 1000);
      if (!transferPort) {
          return false;
      }
      
      this.transferPort = transferPort;
      
      this.transferUdp.onMessage((res) => {
          try {
              let messageStr;
              if (typeof res.message === 'string') {
                  messageStr = res.message;
              } else {
                  messageStr = String.fromCharCode.apply(null, new Uint8Array(res.message));
              }
              
              const message = JSON.parse(messageStr);
              
              switch(message.type) {
                  case 'FILE_START':
                      this.transferUdp.send({
                          address: res.remoteInfo.address,
                          port: res.remoteInfo.port,
                          message: JSON.stringify({
                              type: 'FILE_START_ACK',
                              transferId: message.transferId,
                              timestamp: Date.now()
                          })
                      });
                      
                      this.handleFileStart(message, res.remoteInfo);
                      break;
                      
                  case 'FILE_DATA':
                      this.handleFileData(message, res.remoteInfo);
                      break;
                      
                  case 'FILE_COMPLETE':
                      this.handleFileComplete(message);
                      break;
              }
              
          } catch (error) {}
      });
      
      return true;
  }

  async bindAvailablePort(startingPort = null) {
      const start = startingPort || this.startPort;
      
      for (let i = 0; i < this.maxPortRetries; i++) {
          try {
              const testPort = start + i;
              
              const socket = wx.createUDPSocket();
              const boundPort = socket.bind(testPort);
              
              if (boundPort) {
                  socket.close();
                  return testPort;
              }
              
              socket.close();
              
          } catch (error) {
              continue;
          }
      }
      return null;
  }

  handleUDPError(error) {
      if (this.onError) {
          this.onError({
              type: 'UDP_ERROR',
              message: error.errMsg || '网络连接错误',
              originalError: error
          });
      }
      
      this.cleanup();
  }

  async checkPermissions() {
      try {
          await new Promise((resolve, reject) => {
              wx.authorize({
                  scope: 'scope.userLocation',
                  success: resolve,
                  fail: reject
              });
          });
          return true;
      } catch (error) {
          wx.showModal({
              title: '需要授权',
              content: '请在设置中允许使用位置权限，以便发现附近设备',
              confirmText: '去设置',
              success: (res) => {
                  if (res.confirm) {
                      wx.openSetting();
                  }
              }
          });
          return false;
      }
  }

  async startDiscoveryBroadcast() {
      try {
          const message = {
              type: 'DISCOVER',
              deviceId: this.deviceId,
              deviceName: wx.getSystemInfoSync().brand || '未知设备',
              deviceType: 'lan',
              timestamp: Date.now()
          };

          await this.broadcastMessage(message);

          if (this.discoveryInterval) {
              clearInterval(this.discoveryInterval);
          }

          this.discoveryInterval = setInterval(async () => {
              try {
                  message.timestamp = Date.now();
                  await this.broadcastMessage(message);
              } catch (error) {}
          }, 3000);
      } catch (error) {
          throw error;
      }
  }

  async broadcastMessage(message) {
      if (!this.udp) {
          throw new Error('UDP socket未初始化');
      }
  
      return new Promise((resolve, reject) => {
          try {
              const messageStr = JSON.stringify(message);
  
              this.udp.send({
                  address: '255.255.255.255',
                  port: this.discoveryPort,
                  message: messageStr,
                  success: () => {
                      resolve();
                  },
                  fail: (error) => {
                      reject(error);
                  }
              });
          } catch (error) {
              reject(error);
          }
      });
  }

  handleMessage(res) {
      try {
          if (!res.message) {
              return;
          }
      
          let messageStr;
          if (typeof res.message === 'string') {
              messageStr = res.message;
          } else {
              const uint8Array = new Uint8Array(res.message);
              messageStr = String.fromCharCode.apply(null, uint8Array);
          }
      
          const message = JSON.parse(messageStr);
          
          switch(message.type) {
              case 'DISCOVER':
                  this.handleDiscoveryMessage(message, res.remoteInfo);
                  break;
              case 'DISCOVER_REPLY':
                  this.handleDiscoveryReply(message, res.remoteInfo);
                  break;
              case 'FILE_START':
                  this.handleFileStart(message, res.remoteInfo);
                  break;
              case 'FILE_DATA':
                  this.handleFileData(message, res.remoteInfo);
                  break;
              case 'FILE_ACK':
                  this.handleFileAck(message);
                  break;
              case 'FILE_COMPLETE':
                  this.handleFileComplete(message);
                  break;
              case 'pair_request':
                  this.handlePairRequest(message, res.remoteInfo);
                  break;
              case 'pair_response':
                  this.handlePairResponse(message, res.remoteInfo);
                  break;
              case 'device_state':
                  this.handleDeviceState(message, res.remoteInfo);
                  break;
              case 'PREPARE_TRANSFER':
                  const senderInfo = res.remoteInfo;
                  
                  if (!this.transferUdp) {
                      this.initTransferSocket().then(result => {
                          this.sendToDevice({
                              address: senderInfo.address,
                              port: senderInfo.port
                          }, {
                              type: 'PREPARE_TRANSFER_ACK',
                              transferId: message.transferId,
                              transferPort: this.transferPort,
                              ready: result,
                              timestamp: Date.now()
                          });
                      });
                  } else {
                      this.sendToDevice({
                          address: senderInfo.address,
                          port: senderInfo.port
                      }, {
                          type: 'PREPARE_TRANSFER_ACK',
                          transferId: message.transferId,
                          transferPort: this.transferPort,
                          ready: true,
                          timestamp: Date.now()
                      });
                  }
                  
                  if (this.onPrepareTransfer) {
                      this.onPrepareTransfer(message);
                  }
                  break;
  
              case 'PREPARE_TRANSFER_ACK':
                  if (message.ready) {
                      const transferState = Array.from(this.transferStates.values())
                          .find(state => state.id === message.transferId);
                      
                      if (transferState) {
                          const targetDevice = Array.from(this.lanDevices.values())
                              .find(device => device.address === res.remoteInfo.address);
              
                          if (targetDevice) {
                              targetDevice.transferPort = message.transferPort;
                              this.lanDevices.set(targetDevice.deviceId, targetDevice);
                              
                              this.continueFileTransfer(targetDevice, transferState);
                          }
                      }
                  }
                  break;
              
              case 'TRANSFER_INFO':
                  const device = this.lanDevices.get(message.deviceId);
                  if (device) {
                      device.transferPort = message.transferPort;
                      this.lanDevices.set(message.deviceId, device);
                  }
                  
                  this.udp.send({
                      address: res.remoteInfo.address,
                      port: res.remoteInfo.port,
                      message: JSON.stringify({
                          type: 'TRANSFER_INFO',
                          deviceId: this.deviceId,
                          transferPort: this.transferPort,
                          timestamp: Date.now()
                      })
                  });
                  
                  if (this.onTransferInfoReceived) {
                      this.onTransferInfoReceived(message, res.remoteInfo);
                  }
                  break;
  
              default:
                  break;
          }
      } catch (error) {}
  }

  handleTransferMessage(res) {
      try {
          let messageStr;
          if (typeof res.message === 'string') {
              messageStr = res.message;
          } else {
              messageStr = String.fromCharCode.apply(null, new Uint8Array(res.message));
          }
          
          const message = JSON.parse(messageStr);
          
          switch(message.type) {
              case 'FILE_START': {
                  this.sendSingleFileStartAck(message, res.remoteInfo);
                  this.handleFileStart(message, res.remoteInfo);
                  break;
              }
              case 'FILE_START_ACK': {
                  const ackKey = `${message.transferId}_${message.timestamp}`;
                  if (this.processedAcks.has(ackKey)) {
                      return;
                  }
                  
                  this.processedAcks.set(ackKey, true);
                  setTimeout(() => {
                      this.processedAcks.delete(ackKey);
                  }, 5000);
                  
                  if (this.onFileStartAck) {
                      this.onFileStartAck(message);
                      this.isTransferring = false;
                      this.resetTransferState(); 
                  }
                  break;
              }
              case 'FILE_DATA': {
                  this.handleFileData(message, res.remoteInfo);
                  break;
              }
              case 'FILE_ACK':
                  this.handleFileAck(message);
                  break;
              case 'FILE_COMPLETE':
                  this.handleFileComplete(message);
                  break;
              
              case 'FILE_RECEIVED_CONFIRM': {
                  this.resetTransferState();
                  this.activeTransfers.delete(message.transferId);
                  
                  if (this.onTransferStatusUpdate) {
                      this.onTransferStatusUpdate({
                          status: 'completed',
                          transferId: message.transferId,
                          fileName: message.fileName,
                          timestamp: message.timestamp
                      });
                  }
                  break;
              }
          }
      } catch (error) {}
  }

  sendSingleFileStartAck(message, remoteInfo) {
      const ackMessage = {
          type: 'FILE_START_ACK',
          transferId: message.transferId,
          timestamp: Date.now()
      };
      
      if (this.transferUdp) {
          this.transferUdp.send({
              address: remoteInfo.address,
              port: remoteInfo.port,
              message: JSON.stringify(ackMessage)
          });
      }
  }
  
  handleFileData(message, remoteInfo) {
      if (!this.isTransferring) {
          return;
      }
  
      if (message.transferId !== this.currentTransferId) {
          return;
      }
  
      try {
          const data = wx.base64ToArrayBuffer(message.data);
          
          this.currentChunks.set(message.chunkIndex, data);
          
          for (let i = 0; i < 3; i++) {
              setTimeout(() => {
                  if (this.transferUdp) {
                      const ackMessage = {
                          type: 'FILE_ACK',
                          transferId: message.transferId,
                          chunkIndex: message.chunkIndex,
                          status: 'success',
                          timestamp: Date.now()
                      };
  
                      this.transferUdp.send({
                          address: remoteInfo.address,
                          port: remoteInfo.port,
                          message: JSON.stringify(ackMessage)
                      });
                  }
              }, i * 100);
          }
  
          const totalReceived = Array.from(this.currentChunks.values())
              .reduce((sum, chunk) => sum + chunk.byteLength, 0);
          
          if (this.onProgress) {
              this.onProgress(
                  Math.floor(totalReceived / this.totalSize * 100),
                  totalReceived
              );
          }
  
          if (totalReceived >= this.totalSize) {
              this.handleFileComplete({
                  transferId: this.currentTransferId,
                  timestamp: Date.now()
              });
          }
      } catch (error) {
          if (this.transferUdp) {
              const errorMessage = {
                  type: 'FILE_ACK',
                  transferId: message.transferId,
                  chunkIndex: message.chunkIndex,
                  status: 'error',
                  error: error.message,
                  timestamp: Date.now()
              };
  
              this.transferUdp.send({
                  address: remoteInfo.address,
                  port: remoteInfo.port,
                  message: JSON.stringify(errorMessage)
              });
          }
      }
  }
  
  async sendAck(remoteInfo, ackMessage) {
      try {
          await new Promise((resolve, reject) => {
              if (!this.transferUdp) {
                  reject(new Error('传输socket未初始化'));
                  return;
              }
              
              this.transferUdp.send({
                  address: remoteInfo.address,
                  port: remoteInfo.port || this.transferPort,
                  message: JSON.stringify(ackMessage),
                  success: () => {
                      resolve();
                  },
                  fail: (error) => {
                      reject(error);
                  }
              });
          });
      } catch (error) {}
  }

  handleDeviceState(message, remoteInfo) {
      if (!message.deviceId) return;
      
      const device = this.lanDevices.get(message.deviceId);
      if (device) {
          device.state = message.state;
          device.lastUpdate = Date.now();
          
          if (message.state === 'connected') {
              device.connected = true;
          } else if (message.state === 'disconnected') {
              device.connected = false;
              
              if (this.onConnectionLost) {
                  this.onConnectionLost({
                      deviceId: message.deviceId,
                      deviceName: device.name || device.deviceName || '远程设备',
                      reason: 'remote_disconnect',
                      fromDeviceId: message.deviceId
                  });
              }
          }
          
          this.lanDevices.set(message.deviceId, device);
      }
      
      if (this.onLANDeviceFound) {
          this.onLANDeviceFound(Array.from(this.lanDevices.values()));
      }
  }

  handleDiscoveryMessage(message, remoteInfo) {
      if (message.deviceId === this.deviceId) {
          return;
      }

      const device = {
          deviceId: message.deviceId,
          name: message.deviceName,
          deviceName: message.deviceName,
          address: remoteInfo.address,
          type: message.deviceType || 'lan',
          timestamp: message.timestamp,
          via: 'udp'
      };

      this.lanDevices.set(device.deviceId, device);
      
      if (this.onLANDeviceFound) {
          this.onLANDeviceFound(Array.from(this.lanDevices.values()));
      }

      this.broadcastMessage({
          type: 'DISCOVER_REPLY',
          deviceId: this.deviceId,
          deviceName: wx.getSystemInfoSync().brand || '未知设备',
          deviceType: 'lan',
          timestamp: Date.now()
      });
  }

  handleDiscoveryReply(message, remoteInfo) {
      if (message.deviceId === this.deviceId) return;
  
      const device = {
          deviceId: message.deviceId,
          name: message.deviceName,
          deviceName: message.deviceName,
          address: remoteInfo.address,
          type: message.deviceType || 'lan',
          timestamp: message.timestamp,
          via: 'udp'
      };
  
      this.lanDevices.set(device.deviceId, device);
      
      if (this.onLANDeviceFound) {
          this.onLANDeviceFound(Array.from(this.lanDevices.values()));
      }
  }

  async continueFileTransfer(device, state) {
      try {
          if (!state.fileInfo) {
              throw new Error('文件信息不存在');
          }
  
          if (!state.fileInfo.path) {
              throw new Error('文件路径不存在');
          }
  
          if (!device.transferPort) {
              throw new Error('传输端口未设置');
          }
  
          if (!state.fileInfo.path.startsWith('http://') && 
              !state.fileInfo.path.startsWith('wxfile://')) {
              throw new Error('文件路径格式无效');
          }
  
          const waitForAck = new Promise((resolve, reject) => {
              let timeoutId = setTimeout(() => {
                  this.onFileStartAck = null;
                  reject(new Error('等待文件开始确认超时'));
              }, 10000);
      
              this.onFileStartAck = (ackMessage) => {
                  if (ackMessage.transferId === state.id) {
                      clearTimeout(timeoutId);
                      this.onFileStartAck = null;
                      state.receivedAck = true;
                      state.status = 'transferring';
                      resolve();
                  }
              };
          });
  
          const startMessage = {
              type: 'FILE_START',
              transferId: state.id,
              fileName: state.fileInfo.name,
              originalFileName: state.fileInfo.originalName || state.fileInfo.name,
              fileSize: state.fileInfo.size,
              chunkSize: this.chunkSize,
              timestamp: Date.now()
          };
  
          for (let i = 0; i < 3; i++) {
              setTimeout(async () => {
                  try {
                      await this.sendToDevice(device, startMessage, 'transfer');
                  } catch (error) {}
              }, i * 500);
          }
  
          await waitForAck;
  
          const fileContent = await this.readFile(state.fileInfo.path);
  
          let offset = 0;
          while (offset < state.fileInfo.size) {
              const chunk = fileContent.slice(
                  offset,
                  Math.min(offset + this.chunkSize, state.fileInfo.size)
              );
              
              const chunkMessage = {
                  type: 'FILE_DATA',
                  transferId: state.id,
                  chunkIndex: Math.floor(offset / this.chunkSize),
                  data: wx.arrayBufferToBase64(chunk),
                  checksum: await this.calculateChecksum(chunk),
                  timestamp: Date.now()
              };
              
              await this.sendToDevice(device, chunkMessage, 'transfer');
              offset += chunk.byteLength;
              
              if (this.onProgress) {
                  this.onProgress(
                      Math.floor(offset / state.fileInfo.size * 100),
                      offset
                  );
              }
          }
  
          const completeMessage = {
              type: 'FILE_COMPLETE',
              transferId: state.id,
              fileName: state.fileInfo.name,
              originalFileName: state.fileInfo.originalName || state.fileInfo.name,
              checksum: await this.calculateChecksum(fileContent),
              timestamp: Date.now()
          };
  
          await this.sendToDevice(device, completeMessage, 'transfer');
  
          if (this.onComplete) {
              this.onComplete();
          }
      } catch (error) {
          throw error;
      }
  }

  handleFileStart(message, remoteInfo) {
      if (this.activeTransfers.has(message.transferId)) {
          this.sendFileStartAck(remoteInfo, message.transferId);
          return;
      }

      const processed = this.processedTransfers.get(message.transferId);
      if (processed) {
          const timeDiff = Date.now() - processed.timestamp;
          if (timeDiff < 30000) {
              this.sendFileStartAck(remoteInfo, message.transferId);
              return;
          }
      }

      if (this.lastProcessedFile) {
          const timeDiff = Date.now() - this.lastProcessedFile.timestamp;
          if (timeDiff < 2000 && 
              this.lastProcessedFile.fileName === message.fileName && 
              this.lastProcessedFile.fileSize === message.fileSize) {
              this.sendFileStartAck(remoteInfo, message.transferId);
              return;
          }
      }

      try {
          this.activeTransfers.add(message.transferId);
          
          this.isTransferring = true;
          this.currentTransferId = message.transferId;
          this.currentChunks.clear();
          this.totalSize = message.fileSize;
          
          this.currentFileInfo = {
              fileName: message.fileName,
              originalFileName: message.originalFileName,
              fileSize: message.fileSize
          };
          
          let fileName = '';
          try {
              fileName = decodeURIComponent(escape(message.originalFileName || message.fileName));
          } catch (e) {
              fileName = message.fileName;
          }
          
          if (this.onReceiveStart) {
              this.onReceiveStart(fileName, message.fileSize);
          }
          
          this.sendFileStartAck(remoteInfo, message.transferId);
          
      } catch (error) {
          this.resetTransferState();
          this.activeTransfers.delete(message.transferId);
      }
  }

  sendFileStartAck(remoteInfo, transferId) {
      const ackMessage = {
          type: 'FILE_START_ACK',
          transferId: transferId,
          timestamp: Date.now()
      };
      
      if (this.transferUdp) {
          for (let i = 0; i < 3; i++) {
              setTimeout(() => {
                  this.transferUdp.send({
                      address: remoteInfo.address,
                      port: remoteInfo.port,
                      message: JSON.stringify(ackMessage)
                  });
              }, i * 200);
          }
      }
  }

  handleFileAck(message) {
      const chunkIndex = message.chunkIndex;
      const timeout = this.ackTimeouts.get(chunkIndex);
      
      if (timeout) {
          clearTimeout(timeout);
          this.ackTimeouts.delete(chunkIndex);
      }

      if (message.status === 'success') {
          this.retryCount.delete(chunkIndex);
      }
  }

  async sendFile(filePath, targetDevice) {
      if (targetDevice) {
          targetDevice.isLastSender = true;
          this.lanDevices.set(targetDevice.deviceId, targetDevice);
          
          Array.from(this.lanDevices.values()).forEach(device => {
              if (device.deviceId !== targetDevice.deviceId) {
                  device.isLastSender = false;
                  this.lanDevices.set(device.deviceId, device);
              }
          });
      }
      
      if (this.isTransferring) {
          throw new Error('已有文件正在传输中');
      }
      
      try {
          this.isTransferring = true;
          const fileInfo = await this.getFileInfo(filePath);
          
          const originalFile = arguments.length > 2 ? arguments[2] : null;
          
          const transferId = Date.now().toString();
          const state = {
              id: transferId,
              startTime: Date.now(),
              fileInfo: {
                  ...fileInfo,
                  path: filePath,
                  originalName: originalFile?.originalName || fileInfo.name
              },
              receivedAck: false,
              status: 'preparing'
          };
          this.transferStates.set(transferId, state);
  
          const startMessage = {
              type: 'FILE_START',
              transferId: transferId,
              fileName: fileInfo.name,
              originalFileName: originalFile?.originalName || fileInfo.name,
              fileSize: fileInfo.size,
              chunkSize: this.chunkSize,
              timestamp: Date.now()
          };
  
          await this.sendToDevice(targetDevice, {
              type: 'PREPARE_TRANSFER',
              transferId: transferId,
              timestamp: Date.now()
          });
  
          await new Promise(resolve => setTimeout(resolve, 1000));
  
          const ackPromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                  this.onFileStartAck = null;
                  reject(new Error('等待文件开始确认超时'));
              }, 5000);
              
              this.onFileStartAck = (ackMessage) => {
                  if (ackMessage.transferId === transferId) {
                      clearTimeout(timeout);
                      this.onFileStartAck = null;
                      state.receivedAck = true;
                      state.status = 'transferring';
                      resolve();
                  }
              };
          });
  
          await this.sendToDevice(targetDevice, startMessage, 'transfer');
          
          await ackPromise;
          
          let offset = 0;
          const fileContent = await this.readFile(filePath);
          
          while (offset < fileInfo.size) {
              const chunk = fileContent.slice(
                  offset,
                  Math.min(offset + this.chunkSize, fileInfo.size)
              );
              
              const chunkMessage = {
                  type: 'FILE_DATA',
                  transferId: transferId,
                  chunkIndex: Math.floor(offset / this.chunkSize),
                  data: wx.arrayBufferToBase64(chunk),
                  checksum: await this.calculateChecksum(chunk),
                  timestamp: Date.now()
              };
              
              await this.sendToDevice(targetDevice, chunkMessage, 'transfer');
              offset += chunk.byteLength;
              
              if (this.onProgress) {
                  this.onProgress(
                      Math.floor(offset / fileInfo.size * 100),
                      offset
                  );
              }
          }
  
          const waitForConfirm = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                  this.onTransferStatusUpdate = null;
                  reject(new Error('等待接收确认超时'));
              }, 10000);
  
              const originalHandler = this.onTransferStatusUpdate;
              this.onTransferStatusUpdate = (statusInfo) => {
                  if (statusInfo.status === 'completed' && 
                      statusInfo.transferId === transferId) {
                      clearTimeout(timeout);
                      this.onTransferStatusUpdate = originalHandler;
                      resolve();
                  } else if (originalHandler) {
                      originalHandler(statusInfo);
                  }
              };
          });
  
          const completeMessage = {
              type: 'FILE_COMPLETE',
              transferId: transferId,
              fileName: fileInfo.name,
              originalFileName: originalFile?.originalName || fileInfo.name,
              checksum: await this.calculateChecksum(fileContent),
              timestamp: Date.now()
          };

          await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                  reject(new Error('等待接收确认超时'));  
              }, 10000);

              const onStatusUpdate = (status) => {
                  if(status.status === 'completed' && status.transferId === transferId) {
                      clearTimeout(timeout);
                      this.isTransferring = false;
                      this.currentTransferId = null;
                      resolve();
                  }  
              };

              const originalCallback = this.onTransferStatusUpdate;
              this.onTransferStatusUpdate = (status) => {
                  onStatusUpdate(status);
                  if(originalCallback) originalCallback(status);
              };

              this.sendToDevice(targetDevice, completeMessage, 'transfer').catch(reject);
          });

          this.resetTransferState();

      } catch (error) {
          this.resetTransferState();
          throw error;
      } finally {
          this.isTransferring = false;
      }
  }

  async sendChunkWithRetry(device, chunkMessage, chunkIndex) {
      return new Promise((resolve, reject) => {
          const sendChunk = async () => {
              try {
                  await this.sendToDevice(device, chunkMessage);
                  
                  this.ackTimeouts.set(chunkIndex, setTimeout(() => {
                      const retries = this.retryCount.get(chunkIndex) || 0;
                      if (retries < this.maxRetries) {
                          this.retryCount.set(chunkIndex, retries + 1);
                          sendChunk();
                      } else {
                          reject(new Error(`块${chunkIndex}发送失败`));
                      }
                  }, this.ackTimeout));

              } catch (error) {
                  reject(error);
              }
          };

          sendChunk();
      });
  }

  async sendToDevice(device, message, mode = 'discovery') {
      return new Promise((resolve, reject) => {
          try {
              const targetPort = mode === 'transfer' ? 
                  (device.transferPort || this.transferPort) : 
                  this.discoveryPort;
              const socket = mode === 'transfer' ? this.transferUdp : this.udp;
              
              if (!socket) {
                  throw new Error(`${mode} socket未初始化`);
              }
              
              socket.send({
                  address: device.address,
                  port: targetPort,
                  message: JSON.stringify(message),
                  success: (res) => {
                      resolve(res);
                  },
                  fail: (err) => {
                      reject(err);
                  }
              });
          } catch (error) {
              reject(error);
          }
      });
  }

  async exchangeTransferInfo(device) {
      const info = {
          type: 'TRANSFER_INFO',
          deviceId: this.deviceId,
          transferPort: this.transferPort,
          timestamp: Date.now()
      };
      
      try {
          await this.sendToDevice(device, info);
          
          return new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                  this.onTransferInfoReceived = null;
                  reject(new Error('等待传输信息交换超时'));
              }, 5000);
              
              this.onTransferInfoReceived = (infoMessage, remoteInfo) => {
                  if (infoMessage.deviceId === device.deviceId) {
                      clearTimeout(timeout);
                      this.onTransferInfoReceived = null;
                      
                      device.transferPort = infoMessage.transferPort;
                      
                      resolve(device);
                  }
              };
          });
      } catch (error) {
          throw error;
      }
  }

  async getFileInfo(filePath) {
      return new Promise((resolve, reject) => {
          const fs = wx.getFileSystemManager();
          fs.getFileInfo({
              filePath,
              success: (res) => {
                  const fileName = filePath.split('/').pop();
                  resolve({
                      ...res,
                      name: fileName
                  });
              },
              fail: (error) => {
                  reject(error);
              }
          });
      });
  }

  async readFile(filePath) {
      return new Promise((resolve, reject) => {
          const fs = wx.getFileSystemManager();
          fs.readFile({
              filePath,
              success: res => {
                  resolve(res.data);
              },
              fail: (error) => {
                  reject(error);
              }
          });
      });
  }

  async calculateChecksum(data) {
      const buffer = new Uint8Array(data);
      let hash = 0;
      for (let i = 0; i < buffer.length; i++) {
          hash = ((hash << 5) - hash) + buffer[i];
          hash = hash & hash;
      }
      return hash.toString(16);
  }

  async saveFile(fileName, fileData) {
      if (!fileName) {
          throw new Error('文件名不能为空');
      }
  
      return new Promise((resolve, reject) => {
          const fs = wx.getFileSystemManager();
          const dir = `${wx.env.USER_DATA_PATH}/received_files`;
  
          try {
              try {
                  fs.accessSync(dir);
              } catch (e) {
                  fs.mkdirSync(dir, true);
              }
  
              const timestamp = Date.now();
              const fileNameParts = fileName.split('.');
              const ext = fileNameParts.length > 1 ? fileNameParts.pop() : '';
              const name = fileNameParts.join('.');
              const finalFileName = `${name}_${timestamp}${ext ? '.' + ext : ''}`;
              const filePath = `${dir}/${finalFileName}`;
  
              fs.writeFile({
                  filePath,
                  data: fileData,
                  success: () => {
                      resolve(filePath);
                  },
                  fail: (error) => {
                      reject(error);
                  }
              });
          } catch (error) {
              reject(error);
          }
      });
  }

  async saveFileDevEnv(fileName, fileData) {
      return new Promise((resolve, reject) => {
        const fs = wx.getFileSystemManager();
        const dir = `${wx.env.USER_DATA_PATH}/received_files`;
        
        try {
          try {
            fs.accessSync(dir);
          } catch (e) {
            fs.mkdirSync(dir, true);
          }
          
          const filePath = `${dir}/${fileName}`;
          fs.writeFile({
            filePath,
            data: fileData,
            success: () => {
              resolve(filePath);
            },
            fail: (err) => {
              reject(err);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
  }

  async sendPairRequest(device, pairRequest) {
      return new Promise((resolve, reject) => {
        try {
          if (!device.address) {
            reject(new Error('WiFi配对失败：设备没有IP地址'));
            return;
          }
      
          const messageStr = JSON.stringify(pairRequest);
          
          this.udp.send({
            address: device.address,
            port: this.discoveryPort,
            message: messageStr,
            success: (res) => {
              resolve(res);
            },
            fail: (err) => {
              reject(err);
            }
          });
          
        } catch (error) {
          reject(error);
        }
      });
  }

  handlePairRequest(message, remoteInfo) {
      if (this.onPairRequest) {
          this.onPairRequest(message, remoteInfo, this.udp);
      }
  }

  handlePairResponse(message, remoteInfo) {
      if (this.onPairResponse) {
          this.onPairResponse(message, remoteInfo);
      }
  }

  initPairingListener() {
      return {
          socket: this.udp,
          port: this.discoveryPort
      };
  }

  async handleFileComplete(message) {
      if (!this.isTransferring) {
          return;
      }
  
      try {
          const sortedChunks = Array.from(this.currentChunks.entries())
              .sort(([a], [b]) => a - b)
              .map(([_, chunk]) => chunk);
          
          const totalLength = sortedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  
          const completeFile = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of sortedChunks) {
              completeFile.set(new Uint8Array(chunk), offset);
              offset += chunk.byteLength;
          }
  
          if (!this.currentFileInfo) {
              this.currentFileInfo = {
                  fileName: `received_file_${Date.now()}.dat`,
                  fileSize: totalLength
              };
          }
  
          let fileName = '';
          try {
              const originalName = this.currentFileInfo.originalFileName || this.currentFileInfo.fileName;
              fileName = originalName ? decodeURIComponent(escape(originalName)) : '';
          } catch (e) {
              fileName = this.currentFileInfo.fileName || `received_file_${Date.now()}.dat`;
          }
  
          const filePath = await this.saveFile(fileName, completeFile.buffer);
  
          this.processedTransfers.set(message.transferId, {
              timestamp: Date.now(),
              fileName: fileName,
              fileSize: totalLength,
              path: filePath
          });
  
          if (this.onComplete) {
              const result = {
                  path: filePath,
                  name: fileName,
                  size: totalLength,
                  timestamp: Date.now(),
                  transferId: message.transferId
              };
              this.onComplete(result);
          }
  
          const confirmMessage = {
              type: 'FILE_RECEIVED_CONFIRM',
              transferId: message.transferId,
              fileName: fileName,
              status: 'completed',
              timestamp: Date.now()
          };
  
          if (this.transferUdp) {
              for (let i = 0; i < 3; i++) {
                  this.transferUdp.send({
                      address: '255.255.255.255',
                      port: this.transferPort,
                      message: JSON.stringify(confirmMessage)
                  });
              }
          }
  
          if (this.udp) {
              for (let i = 0; i < 3; i++) {
                  this.udp.send({
                      address: '255.255.255.255',
                      port: this.discoveryPort,
                      message: JSON.stringify(confirmMessage)
                  });
              }
          }
  
          this.resetTransferState();
  
      } catch (error) {
          this.resetTransferState();
          this.isTransferring = false;
          if (this.onError) {
              this.onError({
                  type: 'SAVE_ERROR',
                  message: '保存文件失败',
                  details: error
              });
          }
      }
  }

  cleanup() {
      if (this.discoveryInterval) {
          clearInterval(this.discoveryInterval);
          this.discoveryInterval = null;
      }
      
      if (this.udp) {
          try {
              this.udp.close();
          } catch (error) {}
          this.udp = null;
      }

      if (this.transferUdp) {
          try {
              this.transferUdp.close();
          } catch (error) {}
          this.transferUdp = null;
      }

      this.discoveryPort = null;
      this.transferPort = null;
      this.ackTimeouts.forEach(timeout => clearTimeout(timeout));
      this.ackTimeouts.clear();
      this.currentChunks.clear();
      this.retryCount.clear();
      this.foundDevices.clear();
      this.lanDevices.clear();
      this.isTransferring = false;
      this.isInitializing = false;
      this.onFileStartAck = null;
      this.processedTransfers.clear();
      this.transferLocks.clear();
      this.activeTransfers.clear();
      this.lastProcessedFile = null;
      this.processedAcks.clear();
      this.processedTransfers.clear();
      this.transferLocks.clear();
      this.activeTransfers.clear();
  }
}

export default NetworkManager;
```

### 页面逻辑部分 // index.js

```javascript
/* index.js
 * @author ZU_xian
 * @copyright ZU_xian UDP file transfer WeChat applet
 * Created by ZU_xian (2025)
 * All rights reserved.
 */
import NetworkManager from '../../utils/networkManager.js';

const SERVICE_UUID = '0000FE01-0000-1000-8000-00805F9B34FB';
const formatFileSize = (size) => {
  if (size < 1024) return size + ' B';
  else if (size < 1024 * 1024) return (size / 1024).toFixed(2) + ' KB';
  else if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(2) + ' MB';
  else return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};
const APP_CODE = 'FASTFILE';
const MANUFACTURER_ID = 0xFFFE;
const CHUNK_SIZE = 20;
const PROTOCOL = {
  HEADER: 0xAA55AA55,
  VERSION: 0x02,
  TYPE: {
    FILE_INFO: 0x01,
    FILE_DATA: 0x02,
    ACK: 0x03,
    RESUME: 0x04,
    ERROR: 0x05,
    PAIR_REQUEST: 0x06,
    PAIR_RESPONSE: 0x07
  }
};

Page({
  data: {
    currentRole: '',
    files: [],
    nearbyUsers: [],
    isSearching: false,
    selectedFile: null,
    connectedUser: null,
    transferProgress: 0,
    serviceId: '',
    characteristicId: '',
    receivedData: [],
    receivedSize: 0,
    totalSize: 0,
    isReceiving: false,
    pairCode: '',
    showPairCodeInput: false,
    pendingDeviceId: '',
    transferMode: 'bluetooth',
    expectedChunkIndex: 0,
    isEnhancedMode: false,
    connectionStatus: '',
    pairingStatus: '',
    isPairing: false,
    sentPairRequest: false,
    receivedPairRequest: false,
    pairRequestTimestamp: 0,
    transferStatus: '',
    networkInfo: null,
    canResume: false,
    transferSpeed: 0,
    remainingTime: 0,
    lastTransferTime: null,
    lastTransferSize: 0,
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
    receivedFileHistory: [],
    receivedFiles: [],
    currentReceivedFile: null
  },

  formatFileSize(size) {
    if (size < 1024) return size + ' B';
    else if (size < 1024 * 1024) return (size / 1024).toFixed(2) + ' KB';
    else if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(2) + ' MB';
    else return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },

  formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) return diffDays === 1 ? '昨天' : `${diffDays}天前`;
    else if (diffHours > 0) return `${diffHours}小时前`;
    else if (diffMins > 0) return `${diffMins}分钟前`;
    else return '刚刚';
  },

  copyFilePath(e) {
    const path = e.currentTarget.dataset.path;
    if (!path) return;
    wx.setClipboardData({
      data: path,
      success: () => wx.showToast({ title: '路径已复制', icon: 'success' })
    });
  },

  clearReceivedHistory() {
    wx.showModal({
      title: '清空历史',
      content: '确定要清空接收文件历史记录吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({ receivedFiles: [], receivedFileHistory: [] });
          wx.showToast({ title: '历史已清空', icon: 'success' });
        }
      }
    });
  },

  handleFileItemTap(e) {
    const filePath = e.currentTarget.dataset.filePath;
    if (!filePath) return;
    wx.showActionSheet({
      itemList: ['打开文件', '复制路径', '保存到本地'],
      success: (res) => {
        switch (res.tapIndex) {
          case 0: this.openFile(filePath); break;
          case 1:
            wx.setClipboardData({
              data: filePath,
              success: () => wx.showToast({ title: '路径已复制', icon: 'success' })
            });
            break;
          case 2:
            this.saveFileToUserAccessible(filePath, filePath.split('/').pop())
              .then(() => wx.showToast({ title: '文件已保存', icon: 'success' }))
              .catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
            break;
        }
      }
    });
  },

  openFile(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
      wx.previewImage({
        urls: [filePath],
        fail: () => wx.showToast({ title: '无法预览此文件', icon: 'none' })
      });
    } else if (['mp4', 'mov', '3gp', 'avi'].includes(ext)) {
      wx.navigateTo({ url: `/pages/player/player?filePath=${encodeURIComponent(filePath)}&fileType=video` });
    } else if (['mp3', 'wav', 'aac', 'flac'].includes(ext)) {
      wx.navigateTo({ url: `/pages/player/player?filePath=${encodeURIComponent(filePath)}&fileType=audio` });
    } else if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'txt'].includes(ext)) {
      wx.openDocument({
        filePath: filePath,
        showMenu: true,
        fail: () => wx.showToast({ title: '无法预览此文件', icon: 'none' })
      });
    } else wx.showToast({ title: '无法直接预览此类型文件', icon: 'none' });
  },

  syncDeviceState(device, state) {
    if (!this.networkManager || !this.networkManager.udp || !device) return;
    try {
      const stateMessage = {
        type: 'device_state',
        deviceId: this.networkManager.deviceId,
        deviceName: wx.getSystemInfoSync().brand || '远程设备',
        state: state,
        timestamp: Date.now()
      };
      if (device.address) this.networkManager.udp.send({ address: device.address, port: this.networkManager.discoveryPort, message: JSON.stringify(stateMessage) });
      this.networkManager.udp.send({ address: '255.255.255.255', port: this.networkManager.discoveryPort, message: JSON.stringify(stateMessage) });
    } catch (error) {}
  },

  handleBLEValueChange(result) {
    const value = result.value;
    const dv = new DataView(value);
    if (dv.getUint32(0) === PROTOCOL.HEADER) {
      const type = dv.getUint8(5);
      const length = dv.getUint16(6);
      const payload = new Uint8Array(value.slice(8, 8 + length));
      switch(type) {
        case PROTOCOL.TYPE.PAIR_REQUEST: this.handlePairRequest(result.deviceId, payload); break;
        case PROTOCOL.TYPE.PAIR_RESPONSE: this.handlePairResponse(result.deviceId, payload); break;
        case PROTOCOL.TYPE.FILE_INFO:
          const info = JSON.parse(new TextDecoder().decode(payload));
          this.setData({ isReceiving: true, totalSize: info.size, receivedSize: 0, receivedData: [], expectedChunkIndex: 0, transferStatus: 'receiving' });
          break;
        case PROTOCOL.TYPE.FILE_DATA:
          const chunkIndex = dv.getUint16(8);
          if (chunkIndex === this.data.expectedChunkIndex) {
            this.data.receivedData.push(payload.slice(2));
            this.setData({
              receivedSize: this.data.receivedSize + payload.byteLength - 2,
              transferProgress: Math.floor((this.data.receivedSize + payload.byteLength - 2) / this.data.totalSize * 100),
              expectedChunkIndex: this.data.expectedChunkIndex + 1
            });
            this.updateTransferStats();
          } else this.requestRetransmit();
          break;
        case PROTOCOL.TYPE.ERROR: this.handleTransferError(payload); break;
      }
    }
  },

  async handlePairRequest(deviceId, payload) {
    try {
      const requestData = JSON.parse(new TextDecoder().decode(payload));
      wx.hideLoading();
      this.setData({
        showPairCodeInput: true,
        pendingDeviceId: deviceId,
        pairCode: '',
        isPairing: true,
        receivedPairRequest: true,
        pairRequestTimestamp: requestData.timestamp,
        connectionStatus: `来自 ${requestData.deviceName || '未知设备'} 的连接请求`
      });
    } catch (error) {}
  },

  async onLoad() {
    try {
      this.networkManager = new NetworkManager();
      this.setupNetworkCallbacks();
      this.networkManager.onPairRequest = (request, remoteInfo, socket) => this.handleUDPPairRequest(request, remoteInfo, socket);
      this.networkManager.onPairResponse = (response, remoteInfo) => {
        if (response && this.data.pendingDeviceId) {
          if (typeof this.handlePairResponseWifi === 'function') this.handlePairResponseWifi(this.data.pendingDeviceId, response);
          else {
            wx.hideLoading();
            if (response.success) {
              let tempDevice = null;
              if (this.networkManager && response.fromDeviceId) {
                const remoteDevice = this.networkManager.lanDevices.get(response.fromDeviceId);
                if (remoteDevice) tempDevice = { deviceId: remoteDevice.deviceId, name: remoteDevice.name || remoteDevice.deviceName || '远程设备', address: remoteDevice.address, via: 'wifi', RSSI: -50 };
              }
              if (!tempDevice && remoteInfo) tempDevice = { deviceId: response.deviceId || response.fromDeviceId || 'temp-device', name: '远程设备', address: remoteInfo.address, via: 'wifi', RSSI: -50 };
              if (tempDevice) this.setData({ isPairing: false, sentPairRequest: false, connectedUser: tempDevice, transferStatus: 'connected', connectionStatus: `已连接到 ${tempDevice.name}` });
              wx.showToast({ title: '配对成功', icon: 'success' });
            } else wx.showToast({ title: '配对失败', icon: 'none' });
          }
        }
      };
      if (this.networkManager.initPairingListener) this.networkManager.initPairingListener();
      const networkInfo = await NetworkManager.getNetworkType();
      this.setData({ networkInfo });
      await this.initializeBluetoothTransfer();
      wx.onNetworkStatusChange(async () => await this.checkConnectionStatus());
      wx.onBluetoothAdapterStateChange(async () => await this.checkConnectionStatus());
      wx.onBLEConnectionStateChange((res) => {
        if (!res.connected && this.data.connectedUser) {
          wx.showToast({ title: '连接已断开', icon: 'none' });
          this.setData({ connectedUser: null, transferStatus: 'disconnected' });
          this.handleDisconnection();
        }
      });
    } catch (error) {
      wx.showToast({ title: '初始化失败，请检查设备权限', icon: 'none' });
    }
  },

  setupNetworkCallbacks() {
    this.networkManager.onLANDeviceFound = (devices) => {
      const currentDevices = [...this.data.nearbyUsers];
      devices.forEach(lanDevice => {
        if (lanDevice.deviceId === this.networkManager.deviceId) return;
        const existingIndex = currentDevices.findIndex(device => device.deviceId === lanDevice.deviceId);
        if (existingIndex === -1) currentDevices.push({ ...lanDevice, RSSI: -50, isEnhanced: false });
      });
      this.setData({ nearbyUsers: currentDevices });
    };
    this.networkManager.onReceiveStart = (fileName, fileSize) => {
      wx.showToast({ title: '正在接收文件...', icon: 'loading', duration: 2000 });
      this.setData({ isReceiving: true, totalSize: fileSize, receivedSize: 0, transferStatus: 'receiving', transferProgress: 0 });
    };
    this.networkManager.onProgress = (progress, transferredSize) => {
      this.setData({ transferProgress: progress });
      this.updateTransferStats(transferredSize);
    };
    this.networkManager.onComplete = (result) => {
      try {
        if (!result || !result.path) return;
        const fileKey = `${result.name}_${result.size}_${result.transferId}`;
        if (this.data.receivedFileHistory.includes(fileKey)) return;
        this.setData({ transferStatus: 'completed', transferProgress: 100, selectedFile: null });
        const newHistory = [...this.data.receivedFileHistory, fileKey];
        const newFileInfo = { path: result.path, name: result.name, size: result.size, timestamp: Date.now() };
        this.setData({ receivedFileHistory: newHistory, receivedFiles: [...this.data.receivedFiles, newFileInfo], currentReceivedFile: newFileInfo });
        const innerAudioContext = wx.createInnerAudioContext();
        innerAudioContext.src = '/assets/audio/notification.mp3';
        innerAudioContext.play();
        try { wx.vibrateLong(); } catch (e) {}
        wx.showModal({
          title: '传输完成',
          content: `收到文件"${result.name}"，大小: ${this.formatFileSize(result.size)}`,
          confirmText: '保存',
          cancelText: '关闭',
          success: (res) => {
            if (res.confirm) this.saveFileToUserAccessible(result.path, result.name).then(() => wx.showToast({ title: '文件已保存', icon: 'success' })).catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
            this.setData({ currentReceivedFile: null });
          }
        });
        setTimeout(() => {
          const history = this.data.receivedFileHistory;
          const index = history.indexOf(fileKey);
          if (index > -1) history.splice(index, 1);
          this.setData({ receivedFileHistory: history });
        }, 30000);
      } catch (error) {
        this.setData({ transferStatus: 'error', selectedFile: null });
      }
    };
    this.networkManager.onTransferStatusUpdate = (statusInfo) => {
      if (statusInfo.status === 'completed') this.setData({ transferStatus: 'completed', transferProgress: 100, selectedFile: null });
    };
    this.networkManager.onError = (error) => {
      wx.showToast({ title: error.message || '传输出错', icon: 'none' });
      this.setData({ transferStatus: 'error' });
    };
    this.networkManager.onConnectionLost = (deviceInfo) => {
      if (this.data.connectedUser) {
        this.setData({ connectedUser: null, connectionStatus: '', transferStatus: 'disconnected' });
        wx.setNavigationBarTitle({ title: '面对面快传' });
        wx.showToast({ title: '连接已断开', icon: 'none' });
      }
    };
    this.networkManager.onPairCancel = (message) => {
      if (this.data.showPairCodeInput) {
        const isFromSelf = message.deviceId === this.networkManager.deviceId;
        this.setData({ showPairCodeInput: false, pairCode: '', isPairing: false, pendingDeviceId: '', pairingStatus: '' });
        wx.showToast({ title: isFromSelf ? '您已取消配对' : '对方已取消配对', icon: 'none' });
        try { wx.vibrateLong(); } catch(e) {}
      }
    };
    this.networkManager.onTransferStatusUpdate = (statusInfo) => {
      if (statusInfo.status === 'completed' && (this.data.transferStatus === 'preparing' || this.data.transferStatus === 'transferring')) {
        this.setData({ transferStatus: 'completed', transferProgress: 100 });
        wx.showToast({ title: '传输完成', icon: 'success' });
      }
    };
  },

  async checkConnectionStatus() {
    try {
      const networkInfo = await wx.getNetworkType();
      const isWifiAvailable = networkInfo.networkType === 'wifi';
      let isBluetoothAvailable = false;
      try {
        const bluetoothState = await wx.getBluetoothAdapterState();
        isBluetoothAvailable = bluetoothState.available;
      } catch (error) {}
      let mode = 'none';
      if (isBluetoothAvailable && isWifiAvailable) mode = 'both';
      else if (isBluetoothAvailable) mode = 'bluetooth';
      else if (isWifiAvailable) mode = 'wifi';
      this.setData({ transferMode: mode });
      return mode;
    } catch (error) {
      this.setData({ transferMode: 'none' });
      return 'none';
    }
  },

  async initializeBluetoothTransfer() {
    try {
      const networkInfo = await wx.getNetworkType();
      const isWifiAvailable = networkInfo.networkType === 'wifi';
      let isBluetoothAvailable = false;
      try {
        await wx.openBluetoothAdapter();
        isBluetoothAvailable = true;
      } catch (error) {}
      let mode = 'none';
      if (isBluetoothAvailable && isWifiAvailable) mode = 'both';
      else if (isBluetoothAvailable) mode = 'bluetooth';
      else if (isWifiAvailable) mode = 'wifi';
      this.setData({ transferMode: mode });
    } catch (error) {
      this.setData({ transferMode: 'none' });
    }
  },

  async handleSearchNearby() {
    if (this.data.isSearching) {
      await this.stopSearch();
      return;
    }
    try {
      await this.initializeBluetoothTransfer();
      await this.checkConnectionStatus();
      if (this.data.transferMode === 'none') {
        wx.showToast({ title: '请确保WiFi或蓝牙已开启', icon: 'none' });
        return;
      }
      this.setData({ isSearching: true, nearbyUsers: [], isEnhancedMode: false });
      await this.networkManager.initDiscovery();
      if (this.data.transferMode === 'bluetooth' || this.data.transferMode === 'both') await this.startDeviceDiscovery();
    } catch (error) {
      wx.showToast({ title: error.message || '搜索失败', icon: 'none' });
      this.setData({ isSearching: false });
    }
  },

  async startDeviceDiscovery() {
    try {
      const options = this.data.isEnhancedMode ? { allowDuplicatesKey: false, interval: 0, powerLevel: 'high' } : { allowDuplicatesKey: false, services: [SERVICE_UUID] };
      await wx.stopBluetoothDevicesDiscovery();
      await wx.startBluetoothDevicesDiscovery(options);
      wx.onBluetoothDeviceFound((res) => {
        res.devices.forEach(device => {
          const existingIndex = this.data.nearbyUsers.findIndex(d => d.deviceId === device.deviceId);
          if (this.data.isEnhancedMode) {
            const newDevice = { deviceId: device.deviceId, name: device.name || device.localName || '未知设备', RSSI: device.RSSI, isEnhanced: true, via: 'bluetooth' };
            if (existingIndex === -1) this.setData({ nearbyUsers: [...this.data.nearbyUsers, newDevice] });
          } else {
            if (!device.advertisData) return;
            try {
              const advertisData = new Uint8Array(device.advertisData);
              const view = new DataView(advertisData.buffer);
              if (view.getUint16(0, true) === MANUFACTURER_ID) {
                const appCode = String.fromCharCode(view.getUint8(2), view.getUint8(3), view.getUint8(4), view.getUint8(5));
                if (appCode === APP_CODE) {
                  const newDevice = { deviceId: device.deviceId, name: device.name || '未知设备', RSSI: device.RSSI, isEnhanced: false, via: 'bluetooth' };
                  if (existingIndex === -1) this.setData({ nearbyUsers: [...this.data.nearbyUsers, newDevice] });
                }
              }
            } catch (error) {}
          }
        });
      });
    } catch (error) {}
  },

  async stopSearch() {
    try {
      if (this.data.transferMode === 'bluetooth' || this.data.transferMode === 'both') {
        try {
          const res = await wx.getBluetoothAdapterState();
          if (res.available) {
            await wx.stopBluetoothDevicesDiscovery();
            await wx.closeBluetoothAdapter();
          }
        } catch (error) {}
      }
      if (this.networkManager) await this.networkManager.cleanup();
      this.setData({ isSearching: false, nearbyUsers: [], isEnhancedMode: false, transferMode: 'none' });
    } catch (error) {
      this.setData({ isSearching: false, nearbyUsers: [], isEnhancedMode: false, transferMode: 'none' });
    }
  },

  async toggleEnhancedMode() {
    if (!this.data.isEnhancedMode) {
      wx.showModal({
        title: '开启增强模式',
        content: '该模式下会无视所有设备特征码，直接搜索带有蓝牙信号的设备。通常情况下用不到此功能，一般是搜索老旧设备会比较有用。是否开启？',
        confirmText: '开启',
        cancelText: '取消',
        success: async (res) => {
          if (res.confirm) {
            this.setData({ isEnhancedMode: true });
            await wx.stopBluetoothDevicesDiscovery();
            await this.startDeviceDiscovery();
            wx.showToast({ title: '已开启增强模式', icon: 'none' });
          }
        }
      });
    } else {
      const normalDevices = this.data.nearbyUsers.filter(device => !device.isEnhanced);
      this.setData({ isEnhancedMode: false, nearbyUsers: normalDevices });
      await wx.stopBluetoothDevicesDiscovery();
      await this.startDeviceDiscovery();
      wx.showToast({ title: '已关闭增强模式', icon: 'none' });
    }
    await wx.stopBluetoothDevicesDiscovery();
    await this.startDeviceDiscovery();
  },

  handleConnect(e) {
    const deviceId = e.currentTarget.dataset.deviceid;
    const device = this.data.nearbyUsers.find(d => d.deviceId === deviceId);
    if (!device) {
      wx.showToast({ title: '设备信息无效', icon: 'none' });
      return;
    }
    const systemInfo = wx.getSystemInfoSync();
    const isWindows = systemInfo.platform === 'windows';
    const pairCode = Math.floor(1000 + Math.random() * 9000).toString();
    this.targetPairCode = pairCode;
    wx.showModal({
      title: '设备配对',
      content: `配对码：${pairCode}\n已向对方发送连接请求。`,
      showCancel: true,
      cancelText: '取消',
      success: async (res) => {
        if (res.cancel) {
          this.cancelOngoingPairing();
          if (this.networkManager && this.networkManager.udp) {
            const cancelMessage = { type: 'pair_cancel', deviceId: this.networkManager.deviceId, timestamp: Date.now() };
            this.networkManager.udp.send({ address: '255.255.255.255', port: this.networkManager.discoveryPort, message: JSON.stringify(cancelMessage) });
          }
        }
      }
    });
    try {
      if (isWindows || device.via === 'wifi' || device.via === 'udp' || device.address) this.connectWifi(device, pairCode).catch();
      else {
        this.createBasicConnection(device).then(() => this.sendPairRequest(device.deviceId, pairCode).catch()).catch(error => wx.showToast({ title: '蓝牙连接失败: ' + error.message, icon: 'none' }));
      }
      this.setData({ isPairing: true, sentPairRequest: true, pairDevice: device });
    } catch (error) {
      wx.showToast({ title: '配对请求失败: ' + error.message, icon: 'none' });
    }
  },

  async sendPairRequest(deviceId, pairCode) {
    const encryptedCode = this.encryptPairCode(pairCode);
    const pairRequest = { type: 'pair_request', timestamp: Date.now(), deviceName: wx.getSystemInfoSync().brand || '未知设备', pairCode: pairCode };
    const payload = this.str2ab(JSON.stringify(pairRequest));
    const packet = this.createPacket(PROTOCOL.TYPE.PAIR_REQUEST, payload);
    await this.writeBLEValue(packet);
    setTimeout(() => {
      if (this.data.isPairing && this.data.sentPairRequest) console.log('[配对] 警告：配对请求可能未被接收，对方未显示输入框');
    }, 5000);
  },

  async connectWifi(device, pairCode) {
    try {
      this.setData({ pendingDeviceId: device.deviceId, isPairing: true, sentPairRequest: true, pairingStatus: '等待对方输入配对码...' });
      const pairRequest = { type: 'pair_request', timestamp: Date.now(), deviceName: wx.getSystemInfoSync().brand || '未知设备', pairCode: pairCode, deviceId: device.deviceId };
      if (this.networkManager) {
        try { await this.networkManager.sendPairRequest(device, pairRequest); }
        catch (error) {
          if (this.networkManager.udp) {
            const messageStr = JSON.stringify(pairRequest);
            this.networkManager.udp.send({ address: '255.255.255.255', port: this.networkManager.discoveryPort, message: messageStr });
            if (device.address) this.networkManager.udp.send({ address: device.address, port: this.networkManager.discoveryPort, message: messageStr });
            if (device.address && device.address.startsWith('192.168.')) {
              const parts = device.address.split('.');
              const broadcastAddress = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
              this.networkManager.udp.send({ address: broadcastAddress, port: this.networkManager.discoveryPort, message: messageStr });
            }
            const devtoolsDevice = Array.from(this.networkManager.lanDevices.values()).find(d => d.name === 'devtools' || d.deviceName === 'devtools');
            if (devtoolsDevice && devtoolsDevice.address) this.networkManager.udp.send({ address: devtoolsDevice.address, port: this.networkManager.discoveryPort, message: messageStr });
          }
        }
      } else {
        setTimeout(() => {
          const fakeResponse = { success: true, timestamp: Date.now() };
          this.handlePairResponseWifi(device.deviceId, fakeResponse);
        }, 5000);
      }
    } catch (error) {}
  },

  async createBasicConnection(device) {
    await wx.createBLEConnection({ deviceId: device.deviceId });
    const { services } = await wx.getBLEDeviceServices({ deviceId: device.deviceId });
    for (const service of services) {
      const { characteristics } = await wx.getBLEDeviceCharacteristics({ deviceId: device.deviceId, serviceId: service.uuid });
      const writeChar = characteristics.find(char => char.properties.write || char.properties.writeNoResponse);
      if (writeChar) {
        this.setData({ serviceId: service.uuid, characteristicId: writeChar.uuid, pendingDeviceId: device.deviceId });
        await this.setupBasicReceiver(device.deviceId);
        return;
      }
    }
    throw new Error('未找到可用的传输通道');
  },

  async setupBasicReceiver(deviceId) {
    try {
      try { wx.offBLECharacteristicValueChange(); } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 200));
      const boundHandler = this.handleBLEValueChange.bind(this);
      wx.onBLECharacteristicValueChange(boundHandler);
      await wx.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId: this.data.serviceId,
        characteristicId: this.data.characteristicId,
        state: true
      });
    } catch (error) {
      throw new Error('设置基础接收监听失败');
    }
  },

  generatePairCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  },

  onPairCodeInput(e) {
    const inputCode = e.detail.value;
    this.setData({ pairCode: inputCode });
    if (inputCode.length === 4) {
      if (this.data.receivedPairRequest) {
        if (inputCode === this.targetPairCode) this.confirmPairCode();
        else {
          wx.showToast({ title: '配对码错误', icon: 'error', duration: 1500 });
          setTimeout(() => this.setData({ pairCode: '' }), 200);
        }
      } else if (this.data.sentPairRequest) {
        if (inputCode === this.targetPairCode) this.confirmPairCode();
        else {
          wx.showToast({ title: '配对码错误', icon: 'error', duration: 1500 });
          setTimeout(() => this.setData({ pairCode: '' }), 200);
        }
      }
    }
  },

  cancelPairCode() {
    this.setData({ showPairCodeInput: false, pairCode: '', pendingDeviceId: '' });
  },

  initiatePairing(deviceId) {
    if (this.data.currentRole === 'sender') {
      this.targetPairCode = this.generatePairCode();
      wx.showModal({
        title: '配对码',
        content: `请告诉对方配对码：${this.targetPairCode}`,
        success: () => this.setData({ showPairCodeInput: true, pendingDeviceId: deviceId })
      });
    } else this.setData({ showPairCodeInput: true, pendingDeviceId: deviceId });
  },

  async confirmPairCode() {
    if (!this.data.pairCode || this.data.pairCode.length !== 4) {
      wx.showToast({ title: '请输入4位配对码', icon: 'none' });
      return;
    }
    if (this.data.pairCode !== this.targetPairCode) {
      wx.showToast({ title: '配对码错误', icon: 'error' });
      this.setData({ pairCode: '' });
      return;
    }
    try {
      if ((this.data.connectionMode === 'wifi' || this.data.pendingRemoteInfo) && this.data.pendingRemoteInfo && this.networkManager && this.networkManager.udp) {
        const response = { type: 'pair_response', success: true, timestamp: Date.now(), deviceId: this.data.pendingDeviceId, fromDeviceId: this.networkManager.deviceId, deviceName: wx.getSystemInfoSync().brand || '远程设备', pairCode: this.data.pairCode };
        this.networkManager.udp.send({ address: this.data.pendingRemoteInfo.address, port: this.data.pendingRemoteInfo.port, message: JSON.stringify(response) });
        if (this.data.pendingRemoteInfo.address.startsWith('192.168.')) {
          const parts = this.data.pendingRemoteInfo.address.split('.');
          const broadcastAddress = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
          this.networkManager.udp.send({ address: broadcastAddress, port: this.networkManager.discoveryPort, message: JSON.stringify(response) });
        }
      } else if (this.data.serviceId && this.data.characteristicId) {
        const responsePayload = { success: true, timestamp: Date.now(), pairCode: this.data.pairCode };
        const payload = this.str2ab(JSON.stringify(responsePayload));
        const packet = this.createPacket(PROTOCOL.TYPE.PAIR_RESPONSE, payload);
        await this.writeBLEValue(packet);
      } else throw new Error('无法确定发送配对响应的方式，请检查连接状态');
      let device = this.data.nearbyUsers.find(d => d.deviceId === this.data.pendingDeviceId);
      if (!device && this.networkManager) {
        const remoteDevice = this.networkManager.lanDevices.get(this.data.pendingDeviceId);
        if (remoteDevice) device = { deviceId: remoteDevice.deviceId, name: remoteDevice.name || remoteDevice.deviceName || '远程设备', address: remoteDevice.address, via: 'wifi', RSSI: -50 };
      }
      if (!device && this.data.pendingRemoteInfo) device = { deviceId: this.data.pendingDeviceId || 'temp-device-' + Date.now(), name: '远程设备', address: this.data.pendingRemoteInfo.address, via: 'wifi', RSSI: -50 };
      if (device) {
        this.setData({ showPairCodeInput: false, pairCode: '', isPairing: false, connectedUser: device, transferStatus: 'connected', connectionStatus: `已连接到 ${device.name || '未知设备'}` });
        wx.showToast({ title: '配对成功', icon: 'success' });
        wx.setNavigationBarTitle({ title: `已连接到 ${device.name || '未知设备'}` });
      } else throw new Error('无法创建有效的设备连接');
    } catch (error) {
      wx.showToast({ title: '配对失败: ' + (error.message || '未知错误'), icon: 'none' });
      this.setData({ showPairCodeInput: false, pairCode: '', isPairing: false });
    }
  },

  async cancelOngoingPairing() {
    try {
      if (this.data.pendingDeviceId && (this.data.transferMode === 'bluetooth' || this.data.transferMode === 'both')) {
        try { await wx.closeBLEConnection({ deviceId: this.data.pendingDeviceId }); } catch (error) {}
      }
      if (this.networkManager && this.networkManager.udp) {
        const cancelMessage = { type: 'pair_cancel', deviceId: this.networkManager.deviceId, timestamp: Date.now() };
        if (this.data.pairDevice && this.data.pairDevice.address) this.networkManager.udp.send({ address: this.data.pairDevice.address, port: this.networkManager.discoveryPort, message: JSON.stringify(cancelMessage) });
        this.networkManager.udp.send({ address: '255.255.255.255', port: this.networkManager.discoveryPort, message: JSON.stringify(cancelMessage) });
      }
      this.setData({ isPairing: false, sentPairRequest: false, pendingDeviceId: '', pairingStatus: '', showPairCodeInput: false, pairDevice: null });
      wx.hideLoading();
    } catch (error) {
      this.setData({ isPairing: false, sentPairRequest: false, pendingDeviceId: '', pairingStatus: '', showPairCodeInput: false, pairDevice: null });
      wx.hideLoading();
    }
  },

  async handleUDPPairRequest(request, remoteInfo, socket) {
    try {
      this.targetPairCode = request.pairCode;
      wx.hideLoading();
      const platform = wx.getSystemInfoSync().platform;
      if (platform === 'windows' || platform === 'devtools') {
        this.setData({
          showPairCodeInput: true,
          pendingDeviceId: request.deviceId || request.fromDeviceId,
          pendingRemoteInfo: remoteInfo,
          pendingSocket: socket,
          pairCode: '',
          isPairing: true,
          receivedPairRequest: true,
          pairRequestTimestamp: request.timestamp,
          connectionMode: 'wifi',
          connectionStatus: `来自 ${request.deviceName || '未知设备'} 的配对请求`,
          receivedPairCode: request.pairCode,
          pairDevice: { deviceId: request.deviceId || request.fromDeviceId, name: request.deviceName, address: remoteInfo.address }
        });
      } else {
        this.setData({
          showPairCodeInput: true,
          pendingDeviceId: request.deviceId || request.fromDeviceId,
          pendingRemoteInfo: remoteInfo,
          pendingSocket: socket,
          pairCode: '',
          isPairing: true,
          receivedPairRequest: true,
          pairRequestTimestamp: request.timestamp,
          connectionMode: 'wifi',
          connectionStatus: `来自 ${request.deviceName || '未知设备'} 的配对请求`,
          receivedPairCode: request.pairCode
        });
        try { wx.vibrateLong(); } catch (e) {}
      }
    } catch (error) {
      this.setData({
        showPairCodeInput: true,
        pendingDeviceId: request.deviceId || request.fromDeviceId,
        pendingRemoteInfo: remoteInfo,
        pendingSocket: socket,
        pairCode: '',
        isPairing: true,
        receivedPairRequest: true,
        receivedPairCode: request.pairCode
      });
    }
  },

  encryptPairCode(code) {
    const key = [0x37, 0x92, 0xF6, 0x4D];
    const result = [];
    for (let i = 0; i < code.length; i++) result.push(code.charCodeAt(i) ^ key[i % key.length]);
    return result;
  },

  async rejectPairCode() {
    try {
      const responsePayload = { success: false, reason: '对方取消了配对', timestamp: Date.now() };
      const payload = this.str2ab(JSON.stringify(responsePayload));
      const packet = this.createPacket(PROTOCOL.TYPE.PAIR_RESPONSE, payload);
      await this.writeBLEValue(packet);
    } catch (error) {}
  },

  async handlePairResponseWifi(deviceId, response) {
    try {
      wx.hideLoading();
      if (!response.success) {
        wx.showToast({ title: '配对被拒绝: ' + (response.reason || '未知原因'), icon: 'none' });
        this.setData({ isPairing: false, sentPairRequest: false, pendingDeviceId: '' });
        return;
      }
      let device = null;
      if (response.fromDeviceId && response.fromDeviceId !== this.networkManager.deviceId) {
        device = this.data.nearbyUsers.find(d => d.deviceId === response.fromDeviceId);
        if (!device && this.networkManager) {
          const fromDevice = this.networkManager.lanDevices.get(response.fromDeviceId);
          if (fromDevice) device = { deviceId: fromDevice.deviceId, name: fromDevice.name || fromDevice.deviceName || '远程设备', address: fromDevice.address, via: 'wifi', RSSI: -50 };
        }
      }
      if (!device) device = this.data.nearbyUsers.find(d => d.deviceId === deviceId);
      if (!device && this.networkManager) {
        if (response.fromDeviceId && response.fromDeviceId !== this.networkManager.deviceId) {
          const fromDevice = this.networkManager.lanDevices.get(response.fromDeviceId);
          if (fromDevice) device = { deviceId: fromDevice.deviceId, name: fromDevice.name || fromDevice.deviceName || '远程设备', address: fromDevice.address, via: 'wifi', RSSI: -50 };
        }
        if (!device) {
          const lanDevice = this.networkManager.lanDevices.get(deviceId);
          if (lanDevice) device = { deviceId: lanDevice.deviceId, name: lanDevice.name || lanDevice.deviceName || '远程设备', address: lanDevice.address, via: 'wifi', RSSI: -50 };
        }
      }
      if (device) {
        this.setData({ isPairing: false, sentPairRequest: false, connectedUser: device, transferStatus: 'connected', connectionStatus: `已连接到 ${device.name || '未知设备'}` });
        this.syncDeviceState(device, 'connected');
        wx.showToast({ title: '配对成功', icon: 'success' });
        wx.setNavigationBarTitle({ title: `已连接到 ${device.name || '未知设备'}` });
      } else {
        const tempDevice = { deviceId: deviceId, name: '远程设备', via: 'wifi', address: response.remoteInfo ? response.remoteInfo.address : (this.data.pendingRemoteInfo ? this.data.pendingRemoteInfo.address : null) };
        this.setData({ isPairing: false, sentPairRequest: false, connectedUser: tempDevice, transferStatus: 'connected', connectionStatus: `已连接到远程设备` });
        this.syncDeviceState(tempDevice, 'connected');
        wx.showToast({ title: '配对成功', icon: 'success' });
        wx.setNavigationBarTitle({ title: `已连接到远程设备` });
      }
    } catch (error) {
      wx.showToast({ title: '配对失败: ' + (error.message || '未知错误'), icon: 'none' });
      this.setData({ isPairing: false, sentPairRequest: false, pendingDeviceId: '' });
    }
  },

  async proceedWithConnection(deviceId) {
    const device = this.data.nearbyUsers.find(d => d.deviceId === deviceId);
    if (!device) return;
    try {
      wx.showLoading({ title: '正在连接...' });
      if (device.via === 'bluetooth') await this.connectBluetooth(device);
      else this.setData({ connectedUser: device, transferStatus: 'connected', connectionStatus: `已连接到 ${device.name || '未知设备'}` });
      wx.showToast({ title: '连接成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: '连接失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async connectBluetooth(device) {
    await wx.createBLEConnection({ deviceId: device.deviceId });
    const { services } = await wx.getBLEDeviceServices({ deviceId: device.deviceId });
    for (const service of services) {
      const { characteristics } = await wx.getBLEDeviceCharacteristics({ deviceId: device.deviceId, serviceId: service.uuid });
      const writeChar = characteristics.find(char => char.properties.write || char.properties.writeNoResponse);
      if (writeChar) {
        this.setData({ serviceId: service.uuid, characteristicId: writeChar.uuid, connectedUser: device, transferStatus: 'connected' });
        await this.setupReceiver(device.deviceId);
        return;
      }
    }
    throw new Error('未找到可用的传输通道');
  },

  async setupReceiver(deviceId) {
    try {
      await wx.notifyBLECharacteristicValueChange({ deviceId, serviceId: this.data.serviceId, characteristicId: this.data.characteristicId, state: true });
      wx.onBLECharacteristicValueChange(this.handleBLEValueChange.bind(this));
    } catch (error) {
      throw new Error('设置接收监听失败');
    }
  },

  async handleUpload() {
    if (!this.data.connectedUser) {
      wx.showToast({ title: '请先连接接收方', icon: 'none' });
      return;
    }
    try {
      const fileResult = await new Promise((resolve, reject) => {
        wx.chooseMessageFile({
          count: 1,
          type: 'file',
          success: resolve,
          fail: reject
        });
      });
      if (!fileResult || !fileResult.tempFiles || !fileResult.tempFiles.length) throw new Error('未获取到文件信息');
      const file = fileResult.tempFiles[0];
      this.setData({ selectedFile: {...file, originalName: file.name}, transferStatus: 'preparing', lastTransferTime: Date.now(), lastTransferSize: 0 });
      if (file.size > 100 * 1024 * 1024) {
        wx.showModal({ title: '文件过大', content: '请选择小于100MB的文件', showCancel: false });
        return;
      }
      if (this.data.connectedUser.via === 'bluetooth') await this.sendFileViaBluetooth(file);
      else await this.networkManager.sendFile(file.path, this.data.connectedUser, file);
      wx.showToast({ title: '传输成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '文件处理失败', icon: 'none', duration: 2000 });
      this.setData({ transferStatus: '', selectedFile: null });
    }
  },

  async saveFileToUserAccessible(tempFilePath, fileName) {
    try {
      const systemInfo = wx.getSystemInfoSync();
      const fileExt = fileName.split('.').pop().toLowerCase();
      if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
        return await new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({ filePath: tempFilePath, success: resolve, fail: reject });
        });
      } else if (systemInfo.platform === 'devtools' || systemInfo.platform === 'windows') {
        return tempFilePath;
      } else if (systemInfo.platform === 'android' || systemInfo.platform === 'ios') {
        try {
          return await new Promise((resolve, reject) => {
            wx.saveFileToDisk({
              filePath: tempFilePath,
              fileName: fileName,
              success: resolve,
              fail: (error) => {
                const fs = wx.getFileSystemManager();
                const savedPath = `${wx.env.USER_DATA_PATH}/saved_${Date.now()}_${fileName}`;
                fs.copyFile({ srcPath: tempFilePath, destPath: savedPath, success: () => resolve(savedPath), fail: reject });
              }
            });
          });
        } catch (error) {
          const fs = wx.getFileSystemManager();
          const savedPath = `${wx.env.USER_DATA_PATH}/saved_${Date.now()}_${fileName}`;
          return await new Promise((resolve, reject) => {
            fs.copyFile({ srcPath: tempFilePath, destPath: savedPath, success: () => resolve(savedPath), fail: reject });
          });
        }
      } else {
        const fs = wx.getFileSystemManager();
        const savedPath = `${wx.env.USER_DATA_PATH}/saved_${Date.now()}_${fileName}`;
        return await new Promise((resolve, reject) => {
          fs.copyFile({ srcPath: tempFilePath, destPath: savedPath, success: () => resolve(savedPath), fail: reject });
        });
      }
    } catch (error) {
      throw error;
    }
  },

  async sendFileViaBluetooth(file) {
    try {
      wx.showLoading({ title: '准备发送...' });
      const checksum = await this.calculateFileChecksum(file.path);
      const infoPacket = this.createPacket(PROTOCOL.TYPE.FILE_INFO, this.str2ab(JSON.stringify({ size: file.size, name: file.name, checksum, timestamp: Date.now(), chunks: Math.ceil(file.size / CHUNK_SIZE) })));
      await this.writeBLEValue(infoPacket);
      const fileContent = await this.readFile(file.path);
      for (let i = 0; i * CHUNK_SIZE < fileContent.byteLength; i++) {
        const chunkHeader = new DataView(new ArrayBuffer(2));
        chunkHeader.setUint16(0, i);
        const chunkData = fileContent.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkChecksum = await this.calculateBufferChecksum(chunkData);
        const packet = this.createPacket(PROTOCOL.TYPE.FILE_DATA, this.mergeBuffers(chunkHeader.buffer, chunkChecksum, chunkData));
        await this.writeBLEValue(packet);
        const progress = Math.floor((i + 1) * CHUNK_SIZE / file.size * 100);
        this.setData({ transferProgress: Math.min(progress, 100), transferStatus: 'transferring' });
        this.updateTransferStats(i * CHUNK_SIZE);
      }
      wx.showToast({ title: '发送完成', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: '发送失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ transferProgress: 0, transferStatus: 'completed' });
    }
  },

  updateTransferStats(transferredSize) {
    const now = Date.now();
    const timeDiff = (now - this.data.lastTransferTime) / 1000;
    if (timeDiff > 0) {
      const bytesDiff = transferredSize - this.data.lastTransferSize;
      const speed = bytesDiff / timeDiff;
      const remainingBytes = this.data.selectedFile ? (this.data.selectedFile.size - transferredSize) : 0;
      const remainingTime = speed > 0 ? remainingBytes / speed : 0;
      this.setData({ transferSpeed: this.formatSpeed(speed), remainingTime: this.formatTime(remainingTime), lastTransferTime: now, lastTransferSize: transferredSize });
    }
  },

  formatSpeed(bytesPerSecond) {
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let speed = bytesPerSecond;
    let unitIndex = 0;
    while (speed >= 1024 && unitIndex < units.length - 1) { speed /= 1024; unitIndex++; }
    return `${speed.toFixed(1)} ${units[unitIndex]}`;
  },

  formatTime(seconds) {
    if (seconds < 60) return `${Math.ceil(seconds)}秒`;
    else if (seconds < 3600) return `${Math.ceil(seconds / 60)}分钟`;
    else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.ceil((seconds % 3600) / 60);
      return `${hours}小时${minutes}分钟`;
    }
  },

  createPacket(type, payload) {
    const header = new ArrayBuffer(8);
    const dv = new DataView(header);
    dv.setUint32(0, PROTOCOL.HEADER);
    dv.setUint8(4, PROTOCOL.VERSION);
    dv.setUint8(5, type);
    dv.setUint16(6, payload.byteLength);
    return this.mergeBuffers(header, payload);
  },

  async writeBLEValue(value, retries = 3) {
    const deviceId = this.data.connectedUser ? this.data.connectedUser.deviceId : this.data.pendingDeviceId;
    if (!deviceId) throw new Error('未找到设备ID');
    for (let i = 0; i < retries; i++) {
      try {
        await new Promise((resolve, reject) => {
          wx.writeBLECharacteristicValue({
            deviceId: deviceId,
            serviceId: this.data.serviceId,
            characteristicId: this.data.characteristicId,
            value,
            success: resolve,
            fail: reject
          });
        });
        return;
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  },

  async calculateFileChecksum(filePath) {
    return new Promise((resolve) => {
      wx.getFileSystemManager().readFile({
        filePath,
        success: (res) => {
          const data = new Uint8Array(res.data);
          let hash = 0;
          for (let i = 0; i < data.length; i++) hash = ((hash << 5) - hash) + data[i];
          resolve(hash.toString(16));
        }
      });
    });
  },

  async calculateBufferChecksum(buffer) {
    const data = new Uint8Array(buffer);
    let hash = 0;
    for (let i = 0; i < data.length; i++) hash = ((hash << 5) - hash) + data[i];
    return new TextEncoder().encode(hash.toString(16));
  },

  mergeBuffers(...buffers) {
    const totalLength = buffers.reduce((acc, buf) => acc + buf.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    buffers.forEach(buffer => {
      merged.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    });
    return merged.buffer;
  },

  str2ab(str) {
    return new TextEncoder().encode(str).buffer;
  },

  async readFile(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({ filePath, success: res => resolve(res.data), fail: reject });
    });
  },

  handleDisconnection() {
    if (this.data.transferStatus === 'transferring') this.setData({ transferStatus: 'interrupted', canResume: true });
    if (this.data.reconnectAttempts < this.data.maxReconnectAttempts) this.reconnect();
  },

  async reconnect() {
    this.setData({ reconnectAttempts: this.data.reconnectAttempts + 1 });
    try {
      await this.proceedWithConnection(this.data.connectedUser.deviceId);
      this.setData({ reconnectAttempts: 0 });
    } catch (error) {}
  },

  handleDisconnect() {
    wx.showModal({
      title: '取消连接',
      content: '确定要断开与当前设备的连接吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            if (this.data.connectedUser) {
              const deviceToDisconnect = this.data.connectedUser;
              const disconnectMessage = { type: 'device_state', deviceId: this.networkManager.deviceId, deviceName: wx.getSystemInfoSync().brand || '远程设备', state: 'disconnected', timestamp: Date.now() };
              if (this.networkManager && this.networkManager.udp) {
                const messageStr = JSON.stringify(disconnectMessage);
                if (deviceToDisconnect.address) await new Promise((resolve, reject) => this.networkManager.udp.send({ address: deviceToDisconnect.address, port: this.networkManager.discoveryPort, message: messageStr, success: resolve, fail: reject }));
                await new Promise((resolve, reject) => this.networkManager.udp.send({ address: '255.255.255.255', port: this.networkManager.discoveryPort, message: messageStr, success: resolve, fail: reject }));
              }
              if (deviceToDisconnect.via === 'bluetooth') {
                try { await wx.closeBLEConnection({ deviceId: deviceToDisconnect.deviceId }); } catch (err) {}
              }
              this.setData({ connectedUser: null, connectionStatus: '', transferStatus: 'disconnected', transferProgress: 0 });
              wx.setNavigationBarTitle({ title: '面对面快传' });
              wx.showToast({ title: '已断开连接', icon: 'success' });
            }
          } catch (error) {
            wx.showToast({ title: '断开连接失败', icon: 'none' });
          }
        }
      }
    });
  },

  async onUnload() {
    await this.stopSearch();
    if (this.data.connectedUser && this.data.connectedUser.via === 'bluetooth') {
      try { await wx.closeBLEConnection({ deviceId: this.data.connectedUser.deviceId }); } catch (err) {}
    }
    try { await wx.closeBluetoothAdapter(); } catch (err) {}
    this.setData({ receivedFileHistory: [], receivedFiles: [], currentReceivedFile: null });
    if (this.networkManager) this.networkManager.cleanup();
  },

  simulatePairCodeInput() {
    this.setData({
      showPairCodeInput: true,
      pendingDeviceId: 'test-device-id',
      pairCode: '',
      isPairing: true,
      receivedPairRequest: true,
      pairRequestTimestamp: Date.now(),
      connectionStatus: `来自 测试设备 的连接请求`
    });
  },

  simulatePairRequest() {
    const fakeRequest = { type: 'pair_request', timestamp: Date.now(), deviceName: 'Manual Test', pairCode: '1234', deviceId: 'test-device' };
    const fakeRemoteInfo = { address: '127.0.0.1', port: 40000 };
    this.handleUDPPairRequest(fakeRequest, fakeRemoteInfo, this.networkManager.udp);
  }
});
```
### 页面构建部分 // index.wxml

```javascript
<!--index.wxml
 * @author ZU_xian
 * @copyright ZU_xian UDP file transfer WeChat applet
 * Created by ZU_xian (2025)
 * All rights reserved.
-->
<view class="container">
  <view class="connection-status" wx:if="{{connectedUser}}">
    <view class="status-content">
      <text class="disconnect-btn" bindtap="handleDisconnect">取消连接</text>
    </view>
  </view>

  <view class="transfer-info-panel" wx:if="{{connectedUser}}">
    <view class="transfer-info-container">
      <view class="file-info-section" wx:if="{{selectedFile || currentReceivedFile}}">
        <view class="file-info-header">
          <text class="file-info-title">文件信息</text>
          <text class="file-status-tag {{transferStatus}}">
            {{transferStatus === 'transferring' ? '传输中' : 
            transferStatus === 'completed' ? '已完成' : 
            transferStatus === 'preparing' ? '准备中' :
            transferStatus === 'error' ? '传输失败' : 
            transferStatus === 'interrupted' ? '已中断' : '等待中'}}
          </text>
        </view>
        
        <view class="file-details">
          <text class="file-name">{{(selectedFile && selectedFile.name) || (currentReceivedFile && currentReceivedFile.name) || '无文件名'}}</text>
          <text class="file-size">{{(selectedFile && formatFileSize(selectedFile.size)) || (currentReceivedFile && formatFileSize(currentReceivedFile.size)) || '0 B'}}</text>
        </view>
        
        <view class="transfer-progress-container" wx:if="{{transferProgress > 0}}">
          <progress 
            class="transfer-progress-bar" 
            percent="{{transferProgress}}" 
            stroke-width="4" 
            activeColor="#e77c8e" 
            backgroundColor="#f5f5f5"
          />
          <view class="transfer-stats">
            <text class="transfer-percentage">{{transferProgress}}%</text>
            <text class="transfer-speed" wx:if="{{transferSpeed}}">{{transferSpeed}}</text>
          </view>
        </view>
      </view>
      
      <view class="save-location-section" wx:if="{{currentReceivedFile}}">
        <view class="location-header">
          <text class="location-title">保存位置</text>
          <text class="copy-path" data-path="{{currentReceivedFile.path}}" bindtap="copyFilePath">复制路径</text>
        </view>
        <text class="location-path">{{currentReceivedFile.path}}</text>
      </view>
      
      <view class="recent-files-section" wx:if="{{receivedFiles.length > 0}}">
        <view class="recent-header">
          <text class="recent-title">最近接收的文件</text>
          <text class="clear-history" bindtap="clearReceivedHistory">清空</text>
        </view>
        <scroll-view scroll-y class="recent-files-list">
          <view 
            class="recent-file-item" 
            wx:for="{{receivedFiles}}" 
            wx:key="path"
            bindtap="handleFileItemTap"
            data-file-path="{{item.path}}"
          >
            <view class="file-icon">📄</view>
            <view class="recent-file-info">
              <text class="recent-file-name">{{item.name}}</text>
              <text class="recent-file-meta">{{formatFileSize(item.size)}} · {{formatTimestamp(item.timestamp)}}</text>
            </view>
          </view>
        </scroll-view>
      </view>
      
      <view class="no-transfer-state" wx:if="{{!selectedFile && !currentReceivedFile && receivedFiles.length === 0}}">
        <text class="no-transfer-text">已连接，请点击 + 选择文件发送，或等待接收文件</text>
      </view>
    </view>
  </view>

  <view class="upload-container {{isSearching ? 'hidden' : ''}}">
    <view class="upload-button" bindtap="handleUpload">
      <text class="plus-icon">+</text>
    </view>
  </view>

  <view class="device-list {{isSearching ? 'show' : ''}} {{isEnhancedMode ? 'enhanced' : ''}}">
    <view class="device-list-header">
      <view class="header-content">
        <text wx:if="{{nearbyUsers.length > 0}}">发现 {{nearbyUsers.length}} 个设备</text>
      </view>
      <view class="header-right">
        <text class="transfer-mode-text" wx:if="{{isSearching}}">
          <text class="status-label">目前状态</text>
          {{transferMode === 'both' ? 'WiFi + 蓝牙' : 
          transferMode === 'bluetooth' ? '蓝牙' : 
          transferMode === 'wifi' ? 'WiFi' : 
          '无信号'}}
        </text>
        <view class="enhance-mode-container {{isSearching ? 'show' : ''}}" wx:if="{{isSearching}}">
          <button 
            class="enhance-mode-btn {{isEnhancedMode ? 'active' : ''}}" 
            catchtap="toggleEnhancedMode"
          >
            信号增强 {{isEnhancedMode ? '已开启' : ''}}
          </button>
        </view>
      </view>
    </view>
    
    <view 
      class="device-item {{item.isEnhanced ? 'enhanced' : ''}}" 
      wx:for="{{isSearching ? nearbyUsers : []}}" 
      wx:key="deviceId"
      bindtap="handleConnect"
      data-deviceid="{{item.deviceId}}"
      style="pointer-events: {{connectedUser && (item.deviceId === connectedUser.deviceId || connectedUser) ? 'none' : 'auto'}}"
    >
      <view class="device-info">
        <view class="device-name-container">
          <text class="device-name">{{item.name || '未知设备'}}</text>
          <text class="device-type-tag {{item.via === 'bluetooth' ? 'bluetooth' : 'wifi'}}">
            {{item.via === 'bluetooth' ? '蓝牙' : 'WiFi'}}
          </text>
        </view>
        <text class="device-signal">信号强度: {{item.RSSI}}dBm</text>
        <text class="enhanced-tag" wx:if="{{item.isEnhanced}}">增强发现</text>
      </view>
      <view class="device-status">
        <text class="status-text {{connectedUser && item.deviceId === connectedUser.deviceId ? 'connected' : ''}}">
          {{connectedUser && item.deviceId === connectedUser.deviceId ? '已连接' : 
            connectedUser ? '设备已被占用' : '点击连接'}}
        </text>
      </view>
    </view>
    
    <view class="empty-state" wx:if="{{isSearching && nearbyUsers.length === 0}}">
      <text>请确保另一台设备同样进入此小程序</text>
    </view>
  </view>

  <view class="pair-code-modal" wx:if="{{showPairCodeInput}}">
    <view class="pair-code-content">
      <text class="pair-code-title">设备配对</text>
      <text class="pair-code-subtitle">请输入对方设备显示的4位配对码完成连接</text>
      <input 
        class="pair-code-input" 
        type="number" 
        placeholder="4位配对码"
        maxlength="4"
        value="{{pairCode}}"
        bindinput="onPairCodeInput"
        focus="{{true}}"
      />
      <view class="pair-code-buttons">
        <button class="cancel-btn" bindtap="cancelOngoingPairing">取消</button>
      </view>
    </view>
  </view>

  <view class="transfer-progress" wx:if="{{transferProgress > 0}}">
    <progress percent="{{transferProgress}}" stroke-width="3" activeColor="#e77c8e"/>
    <text class="progress-text">传输进度: {{transferProgress}}%</text>
  </view>

  <view class="bottom-buttons">
    <button 
      class="action-btn search {{isSearching ? 'searching' : ''}}" 
      bindtap="handleSearchNearby"
    >
      {{isSearching ? '停止搜索' : '搜索附近的人'}}
    </button>
    <button 
      class="action-btn send"
      bindtap="handleUpload"
      disabled="{{!connectedUser}}"
    >
      发送
    </button>
  </view>
</view>

<view class="search-loading {{isSearching ? 'show' : ''}}">
  <view class="loading-circle"></view>
</view>

<view class="pairing-status" wx:if="{{false}}">
  <view class="pairing-content">
    <view class="pairing-spinner"></view>
    <text class="pairing-text">{{pairingStatus}}</text>
  </view>
</view>
```

### 样式表部分 // index.wxss

```javascript
/* index.wxss
 * @author ZU_xian
 * @copyright ZU_xian UDP file transfer WeChat applet
 * Created by ZU_xian (2025)
 * All rights reserved.
 */
.container {
    min-height: 100vh;
    background: #ffffff;
    position: relative;
    padding-bottom: constant(safe-area-inset-bottom);
    padding-bottom: env(safe-area-inset-bottom);
}
  
.upload-container {
    position: absolute;
    left: 50%;
    top: 45%;
    transform: translate(-50%, -50%);
    z-index: 1;
}
  
.upload-button {
    width: 160rpx;
    height: 160rpx;
    background: #f8f8f8;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.05);
}
  
.plus-icon {
    font-size: 80rpx;
    color: #666666;
    font-weight: 200;
}
  
.device-list {
    position: fixed;
    bottom: 160rpx;
    left: 0;
    right: 0;
    background: #ffffff;
    padding: 30rpx;
    border-radius: 24rpx 24rpx 0 0;
    box-shadow: 0 -16rpx 24rpx rgba(0, 0, 0, 0.1);
    transform: translateY(100%);
    transition: all 0.3s ease-out;
    max-height: 60vh;
    overflow-y: auto;
    z-index: 2;
    opacity: 0.8;
}

.device-list.show {
    transform: translateY(0);
    opacity: 1;
    box-shadow: 0 -20rpx 24rpx rgba(0, 123, 255, 0.226);
}

.device-list.show.enhanced {
    box-shadow: 0 -20rpx 24rpx rgba(231, 124, 142, 0.404);
}
  
.device-list-header {
    margin-top: -2rpx;
    padding: 20rpx;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}

.enhance-mode-container {
    margin-top: 8rpx;
    position: absolute;
    top: 51rpx;
    left: 260rpx;
    z-index: 3;
}

.enhance-mode-btn {
    background: #e3e3f3;
    color: #666;
    font-size: 28rpx;
    padding: 12rpx 24rpx;
    border-radius: 40rpx;
    border: none;
    max-width: 250rpx;
    height: 60rpx;
    line-height: 40rpx;
    transition: all 0.3s ease;
}

.enhance-mode-btn.active {
    background: #e77c8e;
    color: #fff;
}
  
.device-item {
    padding: 24rpx;
    background: rgb(248, 248, 248);
    border-radius: 16rpx;
    margin-bottom: 16rpx;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 2rpx solid #007AFF;
}

.device-item.enhanced {
    border: 2rpx solid #e77c8e;
    position: relative;
}
  
.device-info {
    flex: 1;
}
  
.device-name {
    font-size: 30rpx;
    color: #333;
    margin-bottom: 8rpx;
    display: block;
}
  
.device-signal {
    font-size: 24rpx;
    color: #999;
}

.enhanced-tag {
    font-size: 20rpx;
    color: #e77c8e;
    background: rgba(231, 124, 142, 0.1);
    padding: 4rpx 12rpx;
    border-radius: 20rpx;
    margin-left: 12rpx;
    display: inline-block;
}
  
.device-status {
    margin-left: 20rpx;
}
  
.status-text {
    font-size: 24rpx;
    color: #666;
}
  
.status-text.connected {
    color: #e77c8e;
}
  
.transfer-progress {
    position: fixed;
    bottom: 140rpx;
    left: 40rpx;
    right: 40rpx;
    background: #fff;
    padding: 20rpx;
    border-radius: 12rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.1);
}
  
.progress-text {
    font-size: 24rpx;
    color: #666;
    margin-top: 8rpx;
    text-align: center;
    display: block;
}
  
.bottom-buttons {
    position: fixed;
    bottom: 40rpx;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    padding: 0 40rpx;
    z-index: 2;
    background: transparent;
    gap: 35rpx;
}
  
.action-btn {
    flex: 1;
    margin: 0 10rpx;
    height: 88rpx;
    border-radius: 44rpx;
    font-size: 28rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
}
  
.action-btn.search {
    background: #e3e3f3;
    color: #333;
}
  
.action-btn.search.searching {
    background: #333;
    color: #fff;
}
  
.action-btn.send {
    background: #ca4c5f;
    color: #FFFFFF;
}
  
.action-btn.send[disabled] {
    background: #f8f8f8;
    color: #999;
}

.search-loading {
    position: fixed;
    bottom: 60rpx; 
    left: 11%;
    transform: translate(-50%, 0);
    z-index: 2;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.3s ease;
}
  
.search-loading.show {
    opacity: 1;
    visibility: visible;
}
  
.loading-circle {
    width: 40rpx;
    height: 40rpx;
    border: 4rpx solid #f3f3f3;
    border-top: 4rpx solid #e77c8e;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}
  
@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.pair-code-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
}
  
.pair-code-content {
    background: #fff;
    padding: 40rpx;
    border-radius: 20rpx;
    width: 85%;
    max-width: 600rpx;
    box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.12);
}
  
.pair-code-title {
    font-size: 36rpx;
    font-weight: 500;
    color: #333;
    text-align: center;
    margin-bottom: 16rpx;
}
  
.pair-code-subtitle {
    font-size: 26rpx;
    color: #666;
    text-align: center;
    margin-bottom: 40rpx;
    display: block;
}
  
.pair-code-input {
    border: 2rpx solid #e5e5e5;
    padding: 24rpx;
    border-radius: 12rpx;
    margin-bottom: 40rpx;
    text-align: center;
    font-size: 48rpx;
    letter-spacing: 16rpx;
    background: #f9f9f9;
}
  
.pair-code-input:focus {
    border-color: #e77c8e;
    background: #fff;
}
  
.pair-code-buttons {
    display: flex;
    justify-content: space-between;
    gap: 20rpx;
    padding: 0 10rpx;
}
  
.cancel-btn, .confirm-btn {
    flex: 1;
    height: 80rpx;
    border-radius: 40rpx;
    font-size: 28rpx;
}
  
.cancel-btn {
    background: #f5f5f5;
    color: #666;
}
  
.confirm-btn {
    background: #e77c8e;
    color: #fff;
}

.empty-state {
    padding: 40rpx;
    text-align: center;
    color: #999;
    font-size: 28rpx;
}

.device-name-container {
    display: flex;
    align-items: center;
    gap: 8rpx;
}

.device-type-tag {
    font-size: 20rpx;
    padding: 4rpx 12rpx;
    border-radius: 20rpx;
    margin-left: 12rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 56rpx;
    height: 32rpx;
    line-height: 0;
}

.device-type-tag.bluetooth {
    color: #007AFF;
    background: rgba(0, 122, 255, 0.1);
}

.device-type-tag.wifi {
    color: #34C759;
    background: rgba(52, 199, 89, 0.1);
}

.device-list-header {
    padding: 30rpx;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}

.header-content {
    display: flex;
    flex-direction: column;
    gap: 8rpx;
    padding-top: 10rpx;
}

.header-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12rpx;
}

.transfer-mode-text {
    font-size: 21rpx;
    color: #666;
    background: #f5f5f5;
    padding: 4rpx 12rpx;
    border-radius: 12rpx;
}

.connection-status {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    padding: 20rpx;
    background: #ffffff;
    text-align: center;
    font-size: 28rpx;
    color: #333;
    border-bottom: 1rpx solid #eee;
    z-index: 100;
}

.connection-status {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    padding: 20rpx 30rpx;
    background: #ffffff;
    border-bottom: 1rpx solid #eee;
    z-index: 100;
}

.status-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 28rpx;
    color: #333;
}

.disconnect-btn {
    color: #666;
    padding: 8rpx 24rpx;
    border-radius: 24rpx;
    background: #f5f5f5;
}

.pairing-status {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.7);
    border-radius: 16rpx;
    padding: 30rpx 40rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99;
    min-width: 300rpx;
}
  
.pairing-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20rpx;
}
  
.pairing-spinner {
    width: 60rpx;
    height: 60rpx;
    border: 4rpx solid rgba(255, 255, 255, 0.3);
    border-top: 4rpx solid #fff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}
  
.pairing-text {
    color: #fff;
    font-size: 28rpx;
}

.transfer-info-panel {
    width: 90%;
    margin: 20rpx auto;
    background: #ffffff;
    border-radius: 20rpx;
    box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.08);
    padding: 30rpx;
    max-height: 60vh;
    overflow: hidden;
}
  
.transfer-info-container {
    display: flex;
    flex-direction: column;
    gap: 30rpx;
}
  
.file-info-section {
    background: #f9f9f9;
    border-radius: 16rpx;
    padding: 24rpx;
}
  
.file-info-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16rpx;
}
  
.file-info-title {
    font-size: 28rpx;
    font-weight: 500;
    color: #333;
}
  
.file-status-tag {
    font-size: 22rpx;
    padding: 4rpx 16rpx;
    border-radius: 20rpx;
    background: #f0f0f0;
    color: #666;
}
  
.file-status-tag.transferring {
    background: rgba(52, 152, 219, 0.1);
    color: #3498db;
}
  
.file-status-tag.completed {
    background: rgba(46, 204, 113, 0.1);
    color: #2ecc71;
}
  
.file-status-tag.preparing {
    background: rgba(241, 196, 15, 0.1);
    color: #f1c40f;
}
  
.file-status-tag.error {
    background: rgba(231, 76, 60, 0.1);
    color: #e74c3c;
}
  
.file-status-tag.interrupted {
    background: rgba(230, 126, 34, 0.1);
    color: #e67e22;
}
  
.file-details {
    margin-bottom: 20rpx;
}
  
.file-name {
    font-size: 30rpx;
    color: #333;
    margin-bottom: 8rpx;
    display: block;
    word-break: break-all;
    text-overflow: ellipsis;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
  
.file-size {
    font-size: 24rpx;
    color: #999;
    display: block;
}
  
.transfer-progress-container {
    margin-top: 20rpx;
}
  
.transfer-progress-bar {
    margin-bottom: 12rpx;
}
  
.transfer-stats {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
  
.transfer-percentage {
    font-size: 24rpx;
    color: #e77c8e;
    font-weight: 500;
}
  
.transfer-speed {
    font-size: 22rpx;
    color: #999;
}
  
.save-location-section {
    background: #f9f9f9;
    border-radius: 16rpx;
    padding: 24rpx;
}
  
.location-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12rpx;
}
  
.location-title {
    font-size: 28rpx;
    font-weight: 500;
    color: #333;
}
  
.copy-path {
    font-size: 24rpx;
    color: #e77c8e;
}
  
.location-path {
    font-size: 24rpx;
    color: #666;
    word-break: break-all;
    display: block;
    background: #f0f0f0;
    padding: 16rpx;
    border-radius: 8rpx;
    margin-top: 10rpx;
}
  
.recent-files-section {
    background: #f9f9f9;
    border-radius: 16rpx;
    padding: 24rpx;
    max-height: 30vh;
    display: flex;
    flex-direction: column;
}
  
.recent-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16rpx;
}
  
.recent-title {
    font-size: 28rpx;
    font-weight: 500;
    color: #333;
}
  
.clear-history {
    font-size: 24rpx;
    color: #999;
}
  
.recent-files-list {
    overflow-y: auto;
    max-height: 25vh;
}
  
.recent-file-item {
    display: flex;
    align-items: center;
    padding: 16rpx;
    border-bottom: 1rpx solid #eee;
}
  
.recent-file-item:last-child {
    border-bottom: none;
}
  
.file-icon {
    font-size: 40rpx;
    margin-right: 16rpx;
}
  
.recent-file-info {
    flex: 1;
    overflow: hidden;
}
  
.recent-file-name {
    font-size: 26rpx;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
}
  
.recent-file-meta {
    font-size: 22rpx;
    color: #999;
    display: block;
}
  
.no-transfer-state {
    padding: 40rpx 0;
    text-align: center;
}
  
.no-transfer-text {
    font-size: 28rpx;
    color: #999;
}
```
# ![微信小程序界面截图](https://i.ibb.co/kg65GNrd/1.png)👉![微信小程序界面截图](https://i.ibb.co/Fqb8mK7b/2.png)👉![微信小程序界面截图](https://i.ibb.co/ZRGCdFNt/3.png)👉![微信小程序界面截图](https://i.ibb.co/C326GHVT/4.png)👉![微信小程序界面截图](https://i.ibb.co/fVY4m6MG/5.png)👉![微信小程序界面截图](https://i.ibb.co/YF0gkMDd/6.png)
