# -
做了一个通过局域网进行传输的微信小程序面对面快传，但是问题在于微信小程序的体量限制，只能使用最原始的UDP进行传输，而我做好了之后发现这个UDP传输放到小程序当中在2025年的今天显得太过于鸡肋，因为传输效率极其低下，发送一个大于10kb的文件可能就无法传输了，只能发送5kb左右的小文件，所以我打算放弃这个项目，因此里面有一些UI问题没有后续的解决。此代码将全部开源，以供大学生进行学习！从代码中可以学习到一些关于蓝牙和UDP建立连接的东西，因为此代码开源请一些营销号不要拿去售卖骗大学生的钱！
使用说明：
1、下载得到pages和utils两个文件夹
2、打开微信开发者工具，新建一个小程序，选择JS-基础模板进行创建
3、把pages和utils复制并粘贴到小程序的根目录进行替换就好了

代码预览：
网络管理部分
# FastFile Transfer Module

一个基于微信小程序的UDP局域网文件传输模块，可实现在局域网中进行快速文件传输。

## 代码预览

### 网络管理部分 // networkManager.js

```javascript
// networkManager.js
/**
 * @author ZU_xian
 * @copyright Sunsoaked FastFile Transfer Module
 * Created by ZU_xian (2025)
 * All rights reserved.
 */
class NetworkManager {
    constructor() {
        this.udp = null;
        this.transferUdp = null;
        this.discoveryPort = null;  // 动态端口
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
        
        // 回调函数
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
        console.log('[传输] 重置传输状态');
        this.isTransferring = false;
        this.currentChunks.clear();
        this.currentTransferId = null;
        this.currentFileInfo = null;
        
        // 清理所有超时器
        this.ackTimeouts.forEach(timeout => clearTimeout(timeout));
        this.ackTimeouts.clear();
        this.retryCount.clear();
        
        // 清理活跃传输记录
        this.activeTransfers.clear();
        
        // 清理已处理的确认消息
        this.processedAcks.clear();
        
        console.log('[传输] 状态已重置完成');
    }

    static async getNetworkType() {
        return new Promise((resolve, reject) => {
            // ZU_xian's file storage path
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
            console.log('初始化已在进行中，跳过...');
            return false;
        }

                // 创建发现socket
        this.udp = wx.createUDPSocket();
        const boundDiscoveryPort = this.udp.bind(discoveryPort);
        if (!boundDiscoveryPort) {
            throw new Error('绑定发现端口失败');
        }
        this.discoveryPort = boundDiscoveryPort;
        console.log('发现socket绑定到端口:', boundDiscoveryPort);

        // 创建传输socket
        this.transferUdp = wx.createUDPSocket();
        const boundTransferPort = this.transferUdp.bind(transferPort);
        if (!boundTransferPort) {
            throw new Error('绑定传输端口失败');
        }
        this.transferPort = boundTransferPort;
        console.log('传输socket绑定到端口:', boundTransferPort);

        // 显式设置广播模式
        this.udp.setBroadcast(true);
        this.transferUdp.setBroadcast(true);

        if (this.initRetryCount >= this.maxInitRetries) {
            console.log('达到最大重试次数，停止初始化');
            return false;
        }

        this.isInitializing = true;
        console.log('开始初始化设备发现...');

        try {
            // 只检查位置权限
            const hasPermission = await this.checkPermissions();
            if (!hasPermission) {
                throw new Error('需要位置权限');
            }

            // 清理现有连接
            this.cleanup();

            // 创建UDP Socket
            console.log('正在创建UDP Socket...');
            // 创建发现用的UDP
            this.udp = wx.createUDPSocket();
            const discoveryPort = await this.bindAvailablePort();
            if (!discoveryPort) {
                throw new Error('无法找到可用的UDP端口');
            }
            this.discoveryPort = discoveryPort;
            
            // 创建传输用的UDP
            this.transferUdp = wx.createUDPSocket();
            const transferPort = await this.bindAvailablePort(this.startPort + 1000);
            if (!transferPort) {
                throw new Error('无法找到可用的传输端口');
            }
            this.transferPort = transferPort;
            
            // 设置传输消息监听
            this.transferUdp.onMessage((res) => {
                console.log('[传输] 收到消息:', res);
                this.handleTransferMessage(res);
            });
            
            // 尝试绑定端口
            const port = await this.bindAvailablePort();
            if (!port) {
                throw new Error('无法找到可用的UDP端口');
            }
            
            this.discoveryPort = port;
            console.log('UDP Socket绑定到端口:', port);
            
            // 设置消息监听
            this.udp.onMessage((res) => {
                console.log('收到UDP消息:', res);
                this.handleMessage(res);
            });

            this.udp.onError((error) => {
                console.error('UDP socket错误:', error);
                this.handleUDPError(error);
            });

            // 启动广播
            await this.startDiscoveryBroadcast();
            console.log('设备发现服务启动完成');

            this.isInitializing = false;
            this.initRetryCount = 0;
            return true;
        } catch (error) {
            console.error('初始化设备发现失败:', error);
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
                } catch (e) {
                    console.log('关闭旧的传输socket失败:', e);
                }
            }
            
            this.transferUdp = wx.createUDPSocket();
            const transferPort = await this.bindAvailablePort(this.startPort + 1000);
            if (!transferPort) {
                console.error('无法找到可用的传输端口');
                return false;
            }
            
            this.transferPort = transferPort;
            console.log('传输socket已绑定到端口:', transferPort);
            
            this.transferUdp.onMessage((res) => {
                console.log('[传输socket] 收到原始消息:', res);
                try {
                    let messageStr;
                    if (typeof res.message === 'string') {
                        messageStr = res.message;
                    } else {
                        messageStr = String.fromCharCode.apply(null, new Uint8Array(res.message));
                    }
                    console.log('[传输socket] 消息内容:', messageStr);
                    
                    const message = JSON.parse(messageStr);
                    console.log('[传输socket] 解析后的消息类型:', message.type);
                    
                    switch(message.type) {
                        case 'FILE_START':
                            console.log('[传输socket] 收到文件开始消息, 立即响应');
                            
                            // 立即响应
                            this.transferUdp.send({
                                address: res.remoteInfo.address,
                                port: res.remoteInfo.port,
                                message: JSON.stringify({
                                    type: 'FILE_START_ACK',
                                    transferId: message.transferId,
                                    timestamp: Date.now()
                                }),
                                success: () => console.log('[传输socket] 文件开始确认发送成功'),
                                fail: (err) => console.error('[传输socket] 文件开始确认发送失败:', err)
                            });
                            
                            // 处理文件开始
                            this.handleFileStart(message, res.remoteInfo);
                            break;
                            
                        case 'FILE_DATA':
                            this.handleFileData(message, res.remoteInfo);
                            break;
                            
                        case 'FILE_COMPLETE':
                            this.handleFileComplete(message);
                            break;
                    }
                    
                } catch (error) {
                    console.error('[传输socket] 处理消息错误:', error);
                }
            });
            
            return true;
        }

    async bindAvailablePort(startingPort = null) {
        // 如果没有指定起始端口，使用默认值
        const start = startingPort || this.startPort;
        
        for (let i = 0; i < this.maxPortRetries; i++) {
            try {
                const testPort = start + i;
                console.log(`尝试绑定端口 ${testPort}...`);
                
                // 先检查端口是否已被使用
                const socket = wx.createUDPSocket();
                const boundPort = socket.bind(testPort);
                
                if (boundPort) {
                    console.log(`成功绑定端口 ${boundPort}`);
                    // 如果这是检查用的socket，先关闭它
                    socket.close();
                    return testPort; // 返回可用的端口号
                }
                
                // 如果绑定失败但没抛出错误，关闭socket继续尝试
                socket.close();
                
            } catch (error) {
                console.log(`端口 ${start + i} 绑定失败:`, error.errMsg || error);
                continue;
            }
        }
        return null;
    }
    
    async initDiscovery() {
        if (this.isInitializing) {
            console.log('初始化已在进行中，跳过...');
            return false;
        }
    
        if (this.initRetryCount >= this.maxInitRetries) {
            console.log('达到最大重试次数，停止初始化');
            return false;
        }
    
        this.isInitializing = true;
        console.log('开始初始化设备发现...');
    
        try {
            // 清理现有连接
            this.cleanup();
    
            // 先找到两个可用端口
            const discoveryPort = await this.bindAvailablePort();
            if (!discoveryPort) {
                throw new Error('无法找到可用的发现端口');
            }
    
            const transferPort = await this.bindAvailablePort(discoveryPort + 1000);
            if (!transferPort) {
                throw new Error('无法找到可用的传输端口');
            }
    
            // 创建并绑定发现socket
            this.udp = wx.createUDPSocket();
            const boundDiscoveryPort = this.udp.bind(discoveryPort);
            if (!boundDiscoveryPort) {
                throw new Error('绑定发现端口失败');
            }
            this.discoveryPort = boundDiscoveryPort;
            
            // 创建并绑定传输socket
            this.transferUdp = wx.createUDPSocket();
            const boundTransferPort = this.transferUdp.bind(transferPort);
            if (!boundTransferPort) {
                throw new Error('绑定传输端口失败');
            }
            this.transferPort = boundTransferPort;
    
            // 设置消息监听器
            this.udp.onMessage((res) => {
                console.log('收到UDP消息:', res);
                this.handleMessage(res);
            });
    
            this.transferUdp.onMessage((res) => {
                console.log('收到传输消息:', res);
                this.handleTransferMessage(res);
            });
    
            this.udp.onError((error) => {
                console.error('UDP socket错误:', error);
                this.handleUDPError(error);
            });
    
            this.transferUdp.onError((error) => {
                console.error('传输socket错误:', error);
                this.handleUDPError(error);
            });
    
            // 启动广播
            await this.startDiscoveryBroadcast();
            console.log('设备发现服务启动完成，发现端口:', this.discoveryPort, '传输端口:', this.transferPort);
    
            this.isInitializing = false;
            this.initRetryCount = 0;
            return true;
    
        } catch (error) {
            console.error('初始化设备发现失败:', error);
            this.isInitializing = false;
            this.initRetryCount++;
            this.cleanup();
            throw error;
        }
    }

    handleUDPError(error) {
        console.error('UDP socket错误:', error);
        // 不再自动重新初始化，而是通知上层
        if (this.onError) {
            this.onError({
                type: 'UDP_ERROR',
                message: error.errMsg || '网络连接错误',
                originalError: error
            });
        }
        
        // 清理资源但不重新初始化
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
            console.error('权限检查失败:', error);
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

            // 发送广播
            await this.broadcastMessage(message);
            console.log('首次广播发送成功');

            // 设置定期广播
            if (this.discoveryInterval) {
                clearInterval(this.discoveryInterval);
            }

            this.discoveryInterval = setInterval(async () => {
                try {
                    message.timestamp = Date.now();
                    await this.broadcastMessage(message);
                } catch (error) {
                    console.error('定期广播失败:', error);
                }
            }, 3000);
        } catch (error) {
            console.error('启动广播失败:', error);
            throw error;
        }
    }

    async broadcastMessage(message) {
        if (!this.udp) {
            throw new Error('UDP socket未初始化');
        }
    
        return new Promise((resolve, reject) => {
            try {
                console.log('准备发送广播消息:', message);
                const messageStr = JSON.stringify(message);
    
                this.udp.send({
                    address: '255.255.255.255',
                    port: this.discoveryPort,
                    message: messageStr,
                    success: () => {
                        console.log('广播消息发送成功');
                        resolve();
                    },
                    fail: (error) => {
                        console.error('广播消息发送失败:', error);
                        reject(error);
                    }
                });
            } catch (error) {
                console.error('广播消息发送出错:', error);
                reject(error);
            }
        });
    }

    handleMessage(res) {
        try {
            console.log('正在处理UDP消息:', res);
            if (!res.message) {
                console.warn('收到空消息');
                return;
            }
        
            let messageStr;
            if (typeof res.message === 'string') {
                messageStr = res.message;
            } else {
                const uint8Array = new Uint8Array(res.message);
                messageStr = String.fromCharCode.apply(null, uint8Array);
            }
        
            console.log('收到的消息字符串:', messageStr);
            const message = JSON.parse(messageStr);
            console.log('解析后的消息:', message);
            
            // 调试日志
            if (message.type === 'pair_request' || message.type === 'pair_response' || message.type === 'pair_cancel') {
                console.log('⭐收到配对相关消息:', message.type, message);
            }
            
            switch(message.type) {
                case 'DISCOVER':
                    console.log('收到设备发现消息');
                    this.handleDiscoveryMessage(message, res.remoteInfo);
                    break;
                case 'DISCOVER_REPLY':
                    console.log('收到设备回复消息');
                    this.handleDiscoveryReply(message, res.remoteInfo);
                    break;
                case 'FILE_START':
                    console.log('收到文件开始消息');
                    this.handleFileStart(message, res.remoteInfo);
                    break;
                case 'FILE_DATA':
                    console.log('收到文件数据');
                    this.handleFileData(message, res.remoteInfo);
                    break;
                case 'FILE_ACK':
                    console.log('收到确认消息');
                    this.handleFileAck(message);
                    break;
                case 'FILE_COMPLETE':
                    console.log('收到完成消息');
                    this.handleFileComplete(message);
                    break;
                case 'pair_request':
                    console.log('收到配对请求消息');
                    this.handlePairRequest(message, res.remoteInfo);
                    break;
                case 'pair_response':
                    console.log('收到配对响应消息');
                    this.handlePairResponse(message, res.remoteInfo);
                    break;
                case 'device_state':
                    console.log('收到设备状态更新');
                    this.handleDeviceState(message, res.remoteInfo);
                    break;
                case 'PREPARE_TRANSFER':
                    console.log('收到传输准备消息:', message, '来自:', res.remoteInfo);
                    // 确保传输UDP套接字已准备好
                    let socketReady = false;
                    
                    // 保存对方地址信息
                    const senderInfo = res.remoteInfo;
                    
                    if (!this.transferUdp) {
                        console.log('尝试初始化传输socket');
                        this.initTransferSocket().then(result => {
                            socketReady = result;
                            console.log('传输socket初始化结果:', socketReady ? '成功' : '失败', 
                                        '端口:', this.transferPort);
                            
                            // 回复准备就绪状态
                            this.sendToDevice({
                                address: senderInfo.address,
                                port: senderInfo.port
                            }, {
                                type: 'PREPARE_TRANSFER_ACK',
                                transferId: message.transferId,
                                transferPort: this.transferPort,
                                ready: socketReady,
                                timestamp: Date.now()
                            });
                        });
                    } else {
                        console.log('传输socket已就绪，端口:', this.transferPort);
                        socketReady = true;
                        
                        // 立即回复准备就绪
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
                    } else {
                        console.warn('未设置onPrepareTransfer回调');
                    }
                    break;
    
                    case 'PREPARE_TRANSFER_ACK':
                        console.log('[传输] 收到传输准备确认:', message);
                        if (message.ready) {
                            const transferState = Array.from(this.transferStates.values())
                                .find(state => state.id === message.transferId);
                            
                            // 调试日志
                            console.log('[传输] 查找传输状态:', {
                                targetId: message.transferId,
                                foundState: transferState,
                                allStates: Array.from(this.transferStates.entries())
                            });
                    
                            if (transferState) {
                                // 更新目标设备的传输端口
                                const targetDevice = Array.from(this.lanDevices.values())
                                    .find(device => device.address === res.remoteInfo.address);
                    
                                if (targetDevice) {
                                    targetDevice.transferPort = message.transferPort;
                                    this.lanDevices.set(targetDevice.deviceId, targetDevice);
                                    
                                    console.log('[传输] 准备继续传输，设备信息:', targetDevice);
                                    
                                    // 继续文件传输流程
                                    this.continueFileTransfer(targetDevice, transferState);
                                } else {
                                    console.error('[传输] 未找到目标设备:', res.remoteInfo.address);
                                }
                            } else {
                                console.error('[传输] 未找到对应的传输状态:', message.transferId);
                            }
                        } else {
                            console.error('[传输] 设备未准备就绪');
                        }
                        break;
                
                case 'TRANSFER_INFO':
                    console.log('收到传输信息:', message);
                    const device = this.lanDevices.get(message.deviceId);
                    if (device) {
                        device.transferPort = message.transferPort;
                        this.lanDevices.set(message.deviceId, device);
                    }
                    
                    // 发送响应信息
                    console.log('[传输] 发送传输信息响应到:', res.remoteInfo.address, res.remoteInfo.port);
                    this.udp.send({
                        address: res.remoteInfo.address,
                        port: res.remoteInfo.port,
                        message: JSON.stringify({
                            type: 'TRANSFER_INFO',
                            deviceId: this.deviceId,
                            transferPort: this.transferPort,
                            timestamp: Date.now()
                        }),
                        success: () => console.log('[传输] 传输信息响应发送成功'),
                        fail: (err) => console.error('[传输] 传输信息响应发送失败:', err)
                    });
                    
                    if (this.onTransferInfoReceived) {
                        console.log('[传输] 调用 onTransferInfoReceived 回调');
                        this.onTransferInfoReceived(message, res.remoteInfo);
                    } else {
                        console.warn('[传输] onTransferInfoReceived 回调未设置');
                    }
                    break;
    
                default:
                    console.warn('未知消息类型:', message.type);
            }
        } catch (error) {
            console.error('处理消息失败:', error);
        }
    }

    handleTransferMessage(res) {
        try {
            console.log('[传输] 收到原始消息:', res);
            
            let messageStr;
            if (typeof res.message === 'string') {
                messageStr = res.message;
            } else {
                messageStr = String.fromCharCode.apply(null, new Uint8Array(res.message));
            }
            
            const message = JSON.parse(messageStr);
            console.log('[传输] 解析的消息对象:', message);
            
            switch(message.type) {
                case 'FILE_START': {
                    console.log('[传输] 收到文件开始消息:', message);
                    // 发送单次确认
                    this.sendSingleFileStartAck(message, res.remoteInfo);
                    this.handleFileStart(message, res.remoteInfo);
                    break;
                }
                case 'FILE_START_ACK': {
                    const ackKey = `${message.transferId}_${message.timestamp}`;
                    if (this.processedAcks.has(ackKey)) {
                        console.log('[传输] 忽略重复的文件开始确认:', ackKey);
                        return;
                    }
                    
                    this.processedAcks.set(ackKey, true);
                    setTimeout(() => {
                        this.processedAcks.delete(ackKey);
                    }, 5000);
                    
                    console.log('[传输] 收到文件开始确认:', message);
                    if (this.onFileStartAck) {
                        this.onFileStartAck(message);
                        this.isTransferring = false;
                        this.resetTransferState(); 
                    }
                    break;
                }
                case 'FILE_DATA': {
                    console.log('[传输] 收到文件数据消息');
                    this.handleFileData(message, res.remoteInfo);
                    break;
                }
                case 'FILE_ACK':
                    this.handleFileAck(message);
                    break;
                case 'FILE_COMPLETE':
                    console.log('[传输] 收到文件完成消息');
                    this.handleFileComplete(message);
                    break;
                
                // 新的case处理接收确认消息
                case 'FILE_RECEIVED_CONFIRM': {
                    console.log('[传输] 收到文件接收确认:', message);
                    
                    // 重置发送方的状态
                    this.resetTransferState();
                    this.activeTransfers.delete(message.transferId);
                    
                    // 通知上层更新状态
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
        } catch (error) {
            console.error('[传输] 处理消息失败:', error);
        }
    }

    //发送单次文件开始确认
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
                message: JSON.stringify(ackMessage),
                success: () => console.log('[传输] 文件开始确认发送成功'),
                fail: (err) => console.error('[传输] 文件开始确认发送失败:', err)
            });
        }
    }
    
    // 新增处理文件数据的方法
    handleFileData(message, remoteInfo) {
        console.log('[传输] 收到文件数据块:', {
            transferId: message.transferId,
            chunkIndex: message.chunkIndex,
            currentTransferId: this.currentTransferId,
            dataSize: message.data.length
        });
    
        if (!this.isTransferring) {
            console.warn('[传输] 未处于传输状态，忽略数据包');
            return;
        }
    
        if (message.transferId !== this.currentTransferId) {
            console.warn('[传输] 传输ID不匹配，忽略数据包');
            return;
        }
    
        try {
            const data = wx.base64ToArrayBuffer(message.data);
            console.log('[传输] 数据块解码成功, 大小:', data.byteLength);
            
            // 保存数据块
            this.currentChunks.set(message.chunkIndex, data);
            
            // 立即发送多次确认以提高可靠性
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
                            message: JSON.stringify(ackMessage),
                            success: () => console.log(`[传输] 第${i + 1}次发送数据确认成功`),
                            fail: (err) => console.error(`[传输] 第${i + 1}次发送数据确认失败:`, err)
                        });
                    }
                }, i * 100);
            }
    
            // 更新进度
            const totalReceived = Array.from(this.currentChunks.values())
                .reduce((sum, chunk) => sum + chunk.byteLength, 0);
            
            if (this.onProgress) {
                this.onProgress(
                    Math.floor(totalReceived / this.totalSize * 100),
                    totalReceived
                );
            }
    
            // 检查是否接收完成
            if (totalReceived >= this.totalSize) {
                console.log('[传输] 数据接收完成，准备处理文件');
                this.handleFileComplete({
                    transferId: this.currentTransferId,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error('[传输] 处理文件数据块失败:', error);
            
            // 发送错误确认
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
                
                console.log('[传输] 发送确认消息:', ackMessage, '到:', remoteInfo);
                
                this.transferUdp.send({
                    address: remoteInfo.address,
                    port: remoteInfo.port || this.transferPort, // 使用对方的端口
                    message: JSON.stringify(ackMessage),
                    success: () => {
                        console.log('[传输] 确认消息发送成功');
                        resolve();
                    },
                    fail: (error) => {
                        console.error('[传输] 确认消息发送失败:', error);
                        reject(error);
                    }
                });
            });
        } catch (error) {
            console.error('[传输] 发送确认失败:', error);
            throw error;
        }
    }

    handleDeviceState(message, remoteInfo) {
        if (!message.deviceId) return;
        
        console.log('[NetworkManager] 处理设备状态更新:', message);
        
        // 更新设备状态
        const device = this.lanDevices.get(message.deviceId);
        if (device) {
            device.state = message.state;
            device.lastUpdate = Date.now();
            
            if (message.state === 'connected') {
                device.connected = true;
            } else if (message.state === 'disconnected') {
                device.connected = false;
                
                // 如果设备断开连接，强制通知上层处理，即使不是当前连接的设备
                if (this.onConnectionLost) {
                    this.onConnectionLost({
                        deviceId: message.deviceId,
                        deviceName: device.name || device.deviceName || '远程设备',
                        reason: 'remote_disconnect',
                        fromDeviceId: message.deviceId  // 标识消息来源
                    });
                }
            }
            
            this.lanDevices.set(message.deviceId, device);
        }
        
        // 通知设备发现
        if (this.onLANDeviceFound) {
            this.onLANDeviceFound(Array.from(this.lanDevices.values()));
        }
    }

    handleDiscoveryMessage(message, remoteInfo) {
        // 忽略自己发出的消息
        if (message.deviceId === this.deviceId) {
            console.log('忽略自己发出的消息');
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

        // 存储设备信息
        this.lanDevices.set(device.deviceId, device);
        
        if (this.onLANDeviceFound) {
            this.onLANDeviceFound(Array.from(this.lanDevices.values()));
        }

        // 发送回复
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
        
        // 特殊处理devtools
        const isDevTools = wx.getSystemInfoSync().platform === 'windows' || 
                          message.deviceName === 'devtools';
        if (isDevTools) {
            console.log('[NetworkManager] 检测到devtools特殊设备');
            // 每次收到搜索回复，自动检查是否有消息要处理
            setTimeout(() => {
                // 此定时器是为了确保UDP socket处理完当前消息
                console.log('[NetworkManager] devtools自动检查是否有配对请求');
            }, 500);
        }
        
        if (this.onLANDeviceFound) {
            this.onLANDeviceFound(Array.from(this.lanDevices.values()));
        }
    }

            async continueFileTransfer(device, state) {
                try {
                    // 详细的状态检查
                    console.log('[传输] 开始继续传输，状态:', {
                        device,
                        state,
                        fileInfo: state.fileInfo
                    });
            
                    // 确保文件信息和路径存在
                    if (!state.fileInfo) {
                        console.error('[传输] 文件信息不存在');
                        throw new Error('文件信息不存在');
                    }
            
                    if (!state.fileInfo.path) {
                        console.error('[传输] 文件路径不存在:', state.fileInfo);
                        throw new Error('文件路径不存在');
                    }
            
                    // 验证设备信息
                    if (!device.transferPort) {
                        console.error('[传输] 传输端口未设置:', device);
                        throw new Error('传输端口未设置');
                    }
            
                    // 验证文件路径格式
                    if (!state.fileInfo.path.startsWith('http://') && 
                        !state.fileInfo.path.startsWith('wxfile://')) {
                        console.error('[传输] 文件路径格式无效:', state.fileInfo.path);
                        throw new Error('文件路径格式无效');
                    }
            
                    console.log('[传输] 准备继续传输:', {
                        deviceInfo: device,
                        stateInfo: state,
                        transferPort: device.transferPort,
                        filePath: state.fileInfo.path  // 文件路径日志
                    });
            
                    // 等待ACK的超时时间延长到10秒
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
            
                    // 多次发送文件开始消息
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
                                console.log(`[传输] 第${i + 1}次发送文件开始消息`);
                            } catch (error) {
                                console.error(`[传输] 第${i + 1}次发送文件开始消息失败:`, error);
                            }
                        }, i * 500);
                    }
            
                    // 等待确认
                    await waitForAck;
                    console.log('[传输] 收到文件开始确认，开始传输数据');
            
                    // 读取文件内容
                    console.log('[传输] 准备读取文件:', state.fileInfo.path);
                    const fileContent = await this.readFile(state.fileInfo.path);
                    console.log('[传输] 文件读取成功，大小:', fileContent.byteLength);
            
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
            
                    // 发送完成消息
                    const completeMessage = {
                        type: 'FILE_COMPLETE',
                        transferId: state.id,
                        fileName: state.fileInfo.name,
                        originalFileName: state.fileInfo.originalName || state.fileInfo.name,
                        checksum: await this.calculateChecksum(fileContent),
                        timestamp: Date.now()
                    };
            
                    await this.sendToDevice(device, completeMessage, 'transfer');
                    console.log('[传输] 文件传输完成');
            
                    if (this.onComplete) {
                        this.onComplete();
                    }
                } catch (error) {
                    console.error('[传输] 继续传输失败:', error);
                    throw error;
                }
            }
    
            handleFileStart(message, remoteInfo) {
                console.log('[传输] 处理文件开始消息:', message, '来自:', remoteInfo);
                
                // 检查是否是重复的传输请求
                if (this.activeTransfers.has(message.transferId)) {
                    console.log('[传输] 该传输已在进行中，发送确认但不重复处理:', message.transferId);
                    this.sendFileStartAck(remoteInfo, message.transferId);
                    return;
                }
        
                // 检查是否是已完成的传输
                const processed = this.processedTransfers.get(message.transferId);
                if (processed) {
                    const timeDiff = Date.now() - processed.timestamp;
                    // 如果在30秒内收到相同的传输，视为重复
                    if (timeDiff < 30000) {
                        console.log('[传输] 该传输刚刚完成，忽略重复请求:', message.transferId);
                        this.sendFileStartAck(remoteInfo, message.transferId);
                        return;
                    }
                }
        
                // 检查最后处理的文件，避免短时间内重复接收
                if (this.lastProcessedFile) {
                    const timeDiff = Date.now() - this.lastProcessedFile.timestamp;
                    if (timeDiff < 2000 && 
                        this.lastProcessedFile.fileName === message.fileName && 
                        this.lastProcessedFile.fileSize === message.fileSize) {
                        console.log('[传输] 检测到可能的重复文件，忽略:', message.fileName);
                        this.sendFileStartAck(remoteInfo, message.transferId);
                        return;
                    }
                }
        
                try {
                    // 记录新的传输
                    this.activeTransfers.add(message.transferId);
                    
                    // 初始化传输状态
                    this.isTransferring = true;
                    this.currentTransferId = message.transferId;
                    this.currentChunks.clear();
                    this.totalSize = message.fileSize;
                    
                    // 保存文件信息
                    this.currentFileInfo = {
                        fileName: message.fileName,
                        originalFileName: message.originalFileName,
                        fileSize: message.fileSize
                    };
                    
                    // 解码文件名
                    let fileName = '';
                    try {
                        fileName = decodeURIComponent(escape(message.originalFileName || message.fileName));
                    } catch (e) {
                        console.warn('[传输] 文件名解码失败，使用原始文件名');
                        fileName = message.fileName;
                    }
                    
                    console.log('[传输] 解码后的文件名:', fileName);
                    
                    // 通知传输开始
                    if (this.onReceiveStart) {
                        this.onReceiveStart(fileName, message.fileSize);
                    }
                    
                    // 发送确认消息
                    this.sendFileStartAck(remoteInfo, message.transferId);
                    
                } catch (error) {
                    console.error('[传输] 处理文件开始消息失败:', error);
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
                    // 多次发送确认以提高可靠性
                    for (let i = 0; i < 3; i++) {
                        setTimeout(() => {
                            this.transferUdp.send({
                                address: remoteInfo.address,
                                port: remoteInfo.port,
                                message: JSON.stringify(ackMessage),
                                success: () => console.log(`[传输] 第${i + 1}次发送文件开始确认成功`),
                                fail: (err) => console.error(`[传输] 第${i + 1}次发送文件开始确认失败:`, err)
                            });
                        }, i * 200);
                    }
                }
            }

            handleFileData(message, remoteInfo) {
                console.log('[传输] 收到文件数据块:', {
                    transferId: message.transferId,
                    chunkIndex: message.chunkIndex,
                    currentTransferId: this.currentTransferId
                });
            
                if (!this.isTransferring) {
                    console.warn('[传输] 未处于传输状态，忽略数据包');
                    return;
                }
            
                if (message.transferId !== this.currentTransferId) {
                    console.warn('[传输] 传输ID不匹配，忽略数据包');
                    return;
                }
            
                try {
                    // 使用 wx.base64ToArrayBuffer 替代 Buffer
                    const data = wx.base64ToArrayBuffer(message.data);
                    console.log('[传输] 数据块解码成功, 大小:', data.byteLength);
                    
                    // 直接保存 ArrayBuffer 数据
                    this.currentChunks.set(message.chunkIndex, data);
                    
                    // 发送确认消息
                    const ackMessage = {
                        type: 'FILE_ACK',
                        transferId: message.transferId,
                        chunkIndex: message.chunkIndex,
                        status: 'success',
                        timestamp: Date.now()
                    };
            
                    // 立即发送多次确认以提高可靠性
                    for (let i = 0; i < 3; i++) {
                        setTimeout(() => {
                            if (this.transferUdp) {
                                this.transferUdp.send({
                                    address: remoteInfo.address,
                                    port: remoteInfo.port,
                                    message: JSON.stringify(ackMessage),
                                    success: () => console.log(`[传输] 第${i + 1}次发送数据确认成功`),
                                    fail: (err) => console.error(`[传输] 第${i + 1}次发送数据确认失败:`, err)
                                });
                            }
                        }, i * 100);
                    }
            
                    // 更新进度
                    const totalReceived = Array.from(this.currentChunks.values())
                        .reduce((sum, chunk) => sum + chunk.byteLength, 0);
                        
                    if (this.onProgress) {
                        this.onProgress(
                            Math.floor(totalReceived / this.totalSize * 100),
                            totalReceived
                        );
                    }
            
                    // 检查是否接收完成
                    if (totalReceived >= this.totalSize) {
                        this.handleFileComplete({
                            transferId: this.currentTransferId,
                            timestamp: Date.now()
                        });
                    }
                } catch (error) {
                    console.error('[传输] 处理文件数据块失败:', error);
                    
                    // 发送错误确认
                    const errorMessage = {
                        type: 'FILE_ACK',
                        transferId: message.transferId,
                        chunkIndex: message.chunkIndex,
                        status: 'error',
                        error: error.message,
                        timestamp: Date.now()
                    };
            
                    if (this.transferUdp) {
                        this.transferUdp.send({
                            address: remoteInfo.address,
                            port: remoteInfo.port,
                            message: JSON.stringify(errorMessage)
                        });
                    }
                }
            }

            async handleFileComplete(message) {
                if (!this.isTransferring) {
                    console.log('[文件保存] 未处于传输状态，忽略完成消息');
                    return;
                }
            
                try {
                    console.log('[文件保存] 开始合并文件数据块...');
                    const sortedChunks = Array.from(this.currentChunks.entries())
                        .sort(([a], [b]) => a - b)
                        .map(([_, chunk]) => chunk);
                    
                    const totalLength = sortedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
                    console.log('[文件保存] 总数据大小:', totalLength);
            
                    const completeFile = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of sortedChunks) {
                        completeFile.set(new Uint8Array(chunk), offset);
                        offset += chunk.byteLength;
                    }
            
                    if (!this.currentFileInfo) {
                        console.warn('[文件保存] 文件信息不存在，使用默认值');
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
                        console.warn('[文件保存] 文件名解码失败:', e);
                        fileName = this.currentFileInfo.fileName || `received_file_${Date.now()}.dat`;
                    }
            
                    console.log('[文件保存] 准备保存文件:', fileName);
                    const filePath = await this.saveFile(fileName, completeFile.buffer);
                    console.log('[文件保存] 文件保存成功:', filePath);
            
                    // 记录已处理的传输
                    this.processedTransfers.set(message.transferId, {
                        timestamp: Date.now(),
                        fileName: fileName,
                        fileSize: totalLength,
                        path: filePath
                    });
            
                    // 通知完成
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
            
                    // 关键修改：发送文件接收确认消息
                    const confirmMessage = {
                        type: 'FILE_RECEIVED_CONFIRM',
                        transferId: message.transferId,
                        fileName: fileName,
                        status: 'completed',
                        timestamp: Date.now()
                    };
            
                    // 通过两个 socket 都发送确认消息
                    if (this.transferUdp) {
                        for (let i = 0; i < 3; i++) {
                            this.transferUdp.send({
                                address: '255.255.255.255',
                                port: this.transferPort,
                                message: JSON.stringify(confirmMessage),
                                success: () => console.log(`[传输] 第${i+1}次发送确认成功(transfer)`),
                                fail: (err) => console.error(`[传输] 第${i+1}次发送确认失败(transfer):`, err)
                            });
                        }
                    }
            
                    if (this.udp) {
                        for (let i = 0; i < 3; i++) {
                            this.udp.send({
                                address: '255.255.255.255',
                                port: this.discoveryPort,
                                message: JSON.stringify(confirmMessage),
                                success: () => console.log(`[传输] 第${i+1}次发送确认成功(discovery)`),
                                fail: (err) => console.error(`[传输] 第${i+1}次发送确认失败(discovery):`, err)
                            });
                        }
                    }
            
                    // 重置接收方状态
                    this.resetTransferState();
            
                } catch (error) {
                    console.error('[文件保存] 保存失败:', error);
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

    // ZU_xian's code protection
    async sendFile(filePath, targetDevice) {
        // 原有的方法完全替换为新的实现
        console.log('[传输] 开始发送文件:', filePath, '目标设备:', targetDevice);
        
        // 标记，记录此设备为最近的发送方
        if (targetDevice) {
            targetDevice.isLastSender = true;
            this.lanDevices.set(targetDevice.deviceId, targetDevice);
            
            // 标记其他设备不是发送方
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
            
            // 获取原始文件信息对象（如果有）
            const originalFile = arguments.length > 2 ? arguments[2] : null;
            
            // 初始化传输状态
            const transferId = Date.now().toString();
            const state = {
                id: transferId,
                startTime: Date.now(),
                fileInfo: {
                    ...fileInfo,
                    path: filePath,  // 确保文件路径
                    originalName: originalFile?.originalName || fileInfo.name
                },
                receivedAck: false,
                status: 'preparing'
            };
            this.transferStates.set(transferId, state);
    
            // 调试日志
            console.log('[传输] 创建传输状态:', {
                transferId,
                fileInfo: state.fileInfo,
                path: filePath
            });
            
            // 发送开始消息并等待确认
            const startMessage = {
                type: 'FILE_START',
                transferId: transferId,
                fileName: fileInfo.name,
                originalFileName: originalFile?.originalName || fileInfo.name,
                fileSize: fileInfo.size,
                chunkSize: this.chunkSize,
                timestamp: Date.now()
            };
    
            console.log('[传输] 发送文件开始消息:', startMessage);
    
            // 先用discovery socket通知对方准备接收
            await this.sendToDevice(targetDevice, {
                type: 'PREPARE_TRANSFER',
                transferId: transferId,
                timestamp: Date.now()
            });
    
            // 给对方1秒时间准备
            await new Promise(resolve => setTimeout(resolve, 1000));
    
            // 等待确认的Promise
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
    
            // 发送开始消息
            await this.sendToDevice(targetDevice, startMessage, 'transfer');
            
            // 等待确认
            await ackPromise;
            console.log('[传输] 接收方已确认准备接收文件');
            
            // 分片发送文件
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
    
            // 等待接收方确认的Promise
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
    
            // 发送完成消息
        const completeMessage = {
            type: 'FILE_COMPLETE',
            transferId: transferId,
            fileName: fileInfo.name,
            originalFileName: originalFile?.originalName || fileInfo.name,
            checksum: await this.calculateChecksum(fileContent),
            timestamp: Date.now()
        };

        // 等待接收方的确认
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('等待接收确认超时'));  
            }, 10000);

            // 一次性的状态更新监听
            const onStatusUpdate = (status) => {
                if(status.status === 'completed' && status.transferId === transferId) {
                    clearTimeout(timeout);
                    // 明确重置状态
                    this.isTransferring = false;
                    this.currentTransferId = null;
                    resolve();
                }  
            };

            // 保存原来的回调并设置新的
            const originalCallback = this.onTransferStatusUpdate;
            this.onTransferStatusUpdate = (status) => {
                onStatusUpdate(status);
                if(originalCallback) originalCallback(status);
            };

            // 发送完成消息
            this.sendToDevice(targetDevice, completeMessage, 'transfer').catch(reject);
        });

        // 确保完全重置状态
        this.resetTransferState();

    } catch (error) {
        console.error('[传输] 发送文件失败:', error);
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
                    
                    // 设置ACK超时
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
                // 确保使用正确的端口，如果是传输模式，优先使用设备的传输端口
                const targetPort = mode === 'transfer' ? 
                    (device.transferPort || this.transferPort) : 
                    this.discoveryPort;
                const socket = mode === 'transfer' ? this.transferUdp : this.udp;
                
                console.log(`[发送] 发送${mode}消息到 ${device.address}:${targetPort}`, message);
                
                if (!socket) {
                    throw new Error(`${mode} socket未初始化`);
                }
                
                socket.send({
                    address: device.address,
                    port: targetPort,
                    message: JSON.stringify(message),
                    success: (res) => {
                        console.log(`[发送] 发送${mode}消息成功`);
                        resolve(res);
                    },
                    fail: (err) => {
                        console.error(`[发送] 发送${mode}消息失败:`, err);
                        reject(err);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // 的新方法
    async exchangeTransferInfo(device) {
        const info = {
            type: 'TRANSFER_INFO',
            deviceId: this.deviceId,
            transferPort: this.transferPort,
            timestamp: Date.now()
        };
        
        console.log('[传输] 发送传输信息:', info, ' 到设备:', device.deviceId);
        
        try {
            await this.sendToDevice(device, info);
            console.log('[传输] 已发送传输信息，等待响应...');
            
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.warn('[传输] 等待传输信息交换超时');
                    this.onTransferInfoReceived = null;
                    reject(new Error('等待传输信息交换超时'));
                }, 5000);
                
                this.onTransferInfoReceived = (infoMessage, remoteInfo) => {
                    console.log('[传输] 收到传输信息响应:', infoMessage);
                    
                    if (infoMessage.deviceId === device.deviceId) {
                        clearTimeout(timeout);
                        this.onTransferInfoReceived = null;
                        
                        // 更新设备传输端口
                        device.transferPort = infoMessage.transferPort;
                        console.log(`[传输] 已获取设备传输端口: ${device.transferPort}`);
                        console.log(`[传输] 端口验证: 本地=${this.transferPort}, 远程=${device.transferPort}`);
                        
                        resolve(device);
                    } else {
                        console.warn('[传输] 收到的设备ID不匹配:', {
                            expected: device.deviceId,
                            received: infoMessage.deviceId
                        });
                    }
                };
            });
        } catch (error) {
            console.error('[传输] 传输信息交换失败:', error);
            throw error;
        }
    }

    async getFileInfo(filePath) {
        return new Promise((resolve, reject) => {
            const fs = wx.getFileSystemManager();
            fs.getFileInfo({
                filePath,
                success: (res) => {
                    console.log('[NetworkManager] 获取文件信息成功:', res);
                    // 从filePath中提取文件名
                    const fileName = filePath.split('/').pop();
                    resolve({
                        ...res,
                        name: fileName
                    });
                },
                fail: (error) => {
                    console.error('[NetworkManager] 获取文件信息失败:', error);
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
                    console.log('[NetworkManager] 读取文件成功, 大小:', res.data.byteLength);
                    resolve(res.data);
                },
                fail: (error) => {
                    console.error('[NetworkManager] 读取文件失败:', error);
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
                // 确保目录存在
                try {
                    fs.accessSync(dir);
                } catch (e) {
                    fs.mkdirSync(dir, true);
                }
    
                // 时间戳避免重名
                const timestamp = Date.now();
                const fileNameParts = fileName.split('.');
                const ext = fileNameParts.length > 1 ? fileNameParts.pop() : '';
                const name = fileNameParts.join('.');
                const finalFileName = `${name}_${timestamp}${ext ? '.' + ext : ''}`;
                const filePath = `${dir}/${finalFileName}`;
    
                console.log('[文件保存] 写入文件:', {
                    path: filePath,
                    size: fileData.byteLength
                });
    
                fs.writeFile({
                    filePath,
                    data: fileData,
                    success: () => {
                        console.log('[文件保存] 写入成功');
                        resolve(filePath);
                    },
                    fail: (error) => {
                        console.error('[文件保存] 写入失败:', error);
                        reject(error);
                    }
                });
            } catch (error) {
                console.error('[文件保存] 保存出错:', error);
                reject(error);
            }
        });
    }

    async saveFileDevEnv(fileName, fileData) {
        return new Promise((resolve, reject) => {
          const fs = wx.getFileSystemManager();
          // 在用户数据目录创建一个专门的文件夹
          const dir = `${wx.env.USER_DATA_PATH}/received_files`;
          
          try {
            // 确保目录存在
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
                console.log(`[开发环境] 文件已保存到: ${filePath}`);
                resolve(filePath);
              },
              fail: (err) => {
                console.error(`[开发环境] 保存文件失败:`, err);
                reject(err);
              }
            });
          } catch (error) {
            reject(error);
          }
        });
      }

    // 发送配对请求
async sendPairRequest(device, pairRequest) {
    // 这里实现UDP发送配对请求的逻辑
    return new Promise((resolve, reject) => {
      try {
        // 如果设备没有IP地址，可能是蓝牙设备
        if (!device.address) {
          reject(new Error('WiFi配对失败：设备没有IP地址'));
          return;
        }
    
        const messageStr = JSON.stringify(pairRequest);
        console.log(`[NetworkManager] 发送UDP配对请求到 ${device.address}:${this.discoveryPort}`);
        
        this.udp.send({
          address: device.address,
          port: this.discoveryPort,
          message: messageStr,
          success: (res) => {
            console.log('[NetworkManager] 配对请求发送成功');
            resolve(res);
          },
          fail: (err) => {
            console.error('[NetworkManager] 配对请求发送失败:', err);
            reject(err);
          }
        });
        
        // 监听响应
        // 注意：这里已经有onMessage监听器了，所以不需要再设置
        
      } catch (error) {
        console.error('[NetworkManager] 发送配对请求出错:', error);
        reject(error);
      }
    });
  }
  
  // 处理配对请求
  handlePairRequest(message, remoteInfo) {
    console.log('[NetworkManager] 处理配对请求:', message);
    
    // 增加日志
  if (this.onPairRequest) {
    console.log('[NetworkManager] 准备调用onPairRequest回调');
    this.onPairRequest(message, remoteInfo, this.udp);
    console.log('[NetworkManager] 已调用onPairRequest回调');
  } else {
    console.error('[NetworkManager] 警告: onPairRequest回调未设置!');
  }
    
    // 通知页面处理配对请求
    if (this.onPairRequest) {
      this.onPairRequest(message, remoteInfo, this.udp);
    }
  }
  
  // 处理配对响应
  handlePairResponse(message, remoteInfo) {
    console.log('[NetworkManager] 处理配对响应:', message);
    
    // 通知页面处理配对响应
    if (this.onPairResponse) {
      this.onPairResponse(message, remoteInfo);
    }
  }
  
  // 初始化配对监听器 - 实际上已经有UDP监听器了，所以这个方法只是标记一下接口完整性
  initPairingListener() {
    console.log('[NetworkManager] 配对监听已初始化 (使用现有UDP socket)');
    return {
      socket: this.udp,
      port: this.discoveryPort
    };
  }

  cleanup() {
    if (this.discoveryInterval) {
        clearInterval(this.discoveryInterval);
        this.discoveryInterval = null;
    }
    
    if (this.udp) {
        try {
            this.udp.close();
        } catch (error) {
            console.error('关闭UDP Socket失败:', error);
        }
        this.udp = null;
    }

    if (this.transferUdp) {
        try {
            this.transferUdp.close();
        } catch (error) {
            console.error('关闭传输Socket失败:', error);
        }
        this.transferUdp = null;
    }

    // 清理所有状态
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

页面逻辑部分
// pages/index/index.js
import NetworkManager from '../../utils/networkManager.js';

const SERVICE_UUID = '0000FE01-0000-1000-8000-00805F9B34FB';
const formatFileSize = (size) => {
    if (size < 1024) {
        return size + ' B';
    } else if (size < 1024 * 1024) {
        return (size / 1024).toFixed(2) + ' KB';
    } else if (size < 1024 * 1024 * 1024) {
        return (size / (1024 * 1024)).toFixed(2) + ' MB';
    } else {
        return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
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
    currentRole: '',            // 当前角色：'sender' 或 'receiver'
    files: [],                 // 文件列表
    nearbyUsers: [],           // 附近的蓝牙设备
    isSearching: false,        // 是否正在搜索设备
    selectedFile: null,        // 选中的文件
    connectedUser: null,       // 已连接的用户
    transferProgress: 0,       // 传输进度(0-100)
    serviceId: '',            // 服务ID
    characteristicId: '',     // 特征值ID
    receivedData: [],         // 接收到的数据
    receivedSize: 0,          // 已接收大小
    totalSize: 0,             // 总大小
    isReceiving: false,       // 是否正在接收
    pairCode: '',            // 配对码
    showPairCodeInput: false, // 是否显示配对码输入框
    pendingDeviceId: '',     // 待连接的设备ID
    transferMode: 'bluetooth', // 传输模式
    expectedChunkIndex: 0,    // 期望的数据块索引
    isEnhancedMode: false,    // 是否启用增强模式
    connectionStatus: '', // 用于显示连接状态
    pairingStatus: '',       // 配对状态信息
    isPairing: false,        // 是否正在配对
    sentPairRequest: false,  // 是否已发送配对请求
    receivedPairRequest: false, // 是否已收到配对请求 
    pairRequestTimestamp: 0 ,  // 配对请求时间戳
    transferStatus: '',       // 传输状态
    networkInfo: null,        // 网络信息
    canResume: false,        // 是否可以恢复传输
    transferSpeed: 0,         // 传输速度
    remainingTime: 0,         // 剩余时间
    lastTransferTime: null,   // 上次传输时间
    lastTransferSize: 0,      // 上次传输大小
    reconnectAttempts: 0,     // 重连尝试次数
    maxReconnectAttempts: 3,  // 最大重连次数
    receivedFileHistory: [], // 改为数组而不是 Set
    receivedFiles: [],
    currentReceivedFile: null
  },

  formatFileSize(size) {
    if (size < 1024) {
        return size + ' B';
    } else if (size < 1024 * 1024) {
        return (size / 1024).toFixed(2) + ' KB';
    } else if (size < 1024 * 1024 * 1024) {
        return (size / (1024 * 1024)).toFixed(2) + ' MB';
    } else {
        return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
  },

// 格式化时间戳
formatTimestamp(timestamp) {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
  
    if (diffDays > 0) {
      return diffDays === 1 ? '昨天' : `${diffDays}天前`;
    } else if (diffHours > 0) {
      return `${diffHours}小时前`;
    } else if (diffMins > 0) {
      return `${diffMins}分钟前`;
    } else {
      return '刚刚';
    }
  },
  
  // 复制文件路径
  copyFilePath(e) {
    const path = e.currentTarget.dataset.path;
    if (!path) return;
    
    wx.setClipboardData({
      data: path,
      success: () => {
        wx.showToast({
          title: '路径已复制',
          icon: 'success'
        });
      }
    });
  },
  
  // 清空接收历史
  clearReceivedHistory() {
    wx.showModal({
      title: '清空历史',
      content: '确定要清空接收文件历史记录吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            receivedFiles: [],
            receivedFileHistory: []
          });
          wx.showToast({
            title: '历史已清空',
            icon: 'success'
          });
        }
      }
    });
  },
  
  // 点击文件项
  handleFileItemTap(e) {
    const filePath = e.currentTarget.dataset.filePath;
    if (!filePath) return;
    
    wx.showActionSheet({
      itemList: ['打开文件', '复制路径', '保存到本地'],
      success: (res) => {
        switch (res.tapIndex) {
          case 0: // 打开文件
            this.openFile(filePath);
            break;
          case 1: // 复制路径
            wx.setClipboardData({
              data: filePath,
              success: () => {
                wx.showToast({
                  title: '路径已复制',
                  icon: 'success'
                });
              }
            });
            break;
          case 2: // 保存到本地
            this.saveFileToUserAccessible(filePath, filePath.split('/').pop())
              .then(() => {
                wx.showToast({
                  title: '文件已保存',
                  icon: 'success'
                });
              })
              .catch(error => {
                console.error('[文件操作] 保存文件失败:', error);
                wx.showToast({
                  title: '保存失败',
                  icon: 'none'
                });
              });
            break;
        }
      }
    });
  },
  
  // 打开文件
  openFile(filePath) {
    // 获取文件扩展名
    const ext = filePath.split('.').pop().toLowerCase();
    
    // 根据文件类型选择不同的打开方式
    if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
      // 图片预览
      wx.previewImage({
        urls: [filePath],
        fail: (err) => {
          console.error('预览图片失败:', err);
          wx.showToast({
            title: '无法预览此文件',
            icon: 'none'
          });
        }
      });
    } else if (['mp4', 'mov', '3gp', 'avi'].includes(ext)) {
      // 视频播放
      wx.navigateTo({
        url: `/pages/player/player?filePath=${encodeURIComponent(filePath)}&fileType=video`
      });
    } else if (['mp3', 'wav', 'aac', 'flac'].includes(ext)) {
      // 音频播放
      wx.navigateTo({
        url: `/pages/player/player?filePath=${encodeURIComponent(filePath)}&fileType=audio`
      });
    } else if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'txt'].includes(ext)) {
      // 文档预览
      wx.openDocument({
        filePath: filePath,
        showMenu: true,
        fail: (err) => {
          console.error('打开文档失败:', err);
          wx.showToast({
            title: '无法预览此文件',
            icon: 'none'
          });
        }
      });
    } else {
      // 其他类型文件
      wx.showToast({
        title: '无法直接预览此类型文件',
        icon: 'none'
      });
    }
  },

// 同步设备状态到对方
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
      
      console.log('[同步] 发送设备状态:', stateMessage);
      
      // 如果有对方地址，发送状态更新
      if (device.address) {
        this.networkManager.udp.send({
          address: device.address,
          port: this.networkManager.discoveryPort,
          message: JSON.stringify(stateMessage),
          success: () => console.log('[同步] 设备状态同步成功'),
          fail: (err) => console.error('[同步] 设备状态同步失败:', err)
        });
      }
      
      // 广播状态更新
      this.networkManager.udp.send({
        address: '255.255.255.255',
        port: this.networkManager.discoveryPort,
        message: JSON.stringify(stateMessage),
        fail: (err) => console.error('[同步] 广播状态同步失败:', err),
        success: () => console.log('[同步] 广播状态同步成功')
      });
    } catch (error) {
      console.error('[同步] 发送设备状态失败:', error);
    }
  },

// 处理蓝牙特征值变化
handleBLEValueChange(result) {
    const value = result.value;
    const dv = new DataView(value);
    
    if (dv.getUint32(0) === PROTOCOL.HEADER) {
      const type = dv.getUint8(5);
      const length = dv.getUint16(6);
      const payload = new Uint8Array(value.slice(8, 8 + length));
      
      switch(type) {
        case PROTOCOL.TYPE.PAIR_REQUEST:
          this.handlePairRequest(result.deviceId, payload);
          break;
          
        case PROTOCOL.TYPE.PAIR_RESPONSE:
          this.handlePairResponse(result.deviceId, payload);
          break;
          
        case PROTOCOL.TYPE.FILE_INFO:
          const info = JSON.parse(new TextDecoder().decode(payload));
          this.setData({
            isReceiving: true,
            totalSize: info.size,
            receivedSize: 0,
            receivedData: [],
            expectedChunkIndex: 0,
            transferStatus: 'receiving'
          });
          break;
          
        case PROTOCOL.TYPE.FILE_DATA:
          const chunkIndex = dv.getUint16(8);
          if (chunkIndex === this.data.expectedChunkIndex) {
            this.data.receivedData.push(payload.slice(2));
            this.setData({
              receivedSize: this.data.receivedSize + payload.byteLength - 2,
              transferProgress: Math.floor(
                (this.data.receivedSize + payload.byteLength - 2) / this.data.totalSize * 100
              ),
              expectedChunkIndex: this.data.expectedChunkIndex + 1
            });
            this.updateTransferStats();
          } else {
            this.requestRetransmit();
          }
          break;
  
        case PROTOCOL.TYPE.ERROR:
          this.handleTransferError(payload);
          break;
      }
    }
  },
  
  // 处理配对请求
  async handlePairRequest(deviceId, payload) {
    try {
      const requestData = JSON.parse(new TextDecoder().decode(payload));
      console.log('[配对] 收到配对请求:', requestData);
      
      wx.hideLoading();
      
      // 显示配对码输入对话框
      this.setData({
        showPairCodeInput: true,
        pendingDeviceId: deviceId,
        pairCode: '',
        isPairing: true,
        receivedPairRequest: true,
        pairRequestTimestamp: requestData.timestamp,
        connectionStatus: `来自 ${requestData.deviceName || '未知设备'} 的连接请求`
      });
    } catch (error) {
      console.error('[配对] 解析配对请求失败:', error);
    }
  },
  
  // 处理配对响应
  async handlePairRequest(deviceId, payload) {
    try {
      const requestData = JSON.parse(new TextDecoder().decode(payload));
      console.log('[配对] 收到配对请求:', requestData);
      
      wx.hideLoading();
      
      // 强制显示提示，先显示模态框
      wx.showModal({
        title: '收到配对请求',
        content: `设备"${requestData.deviceName || '未知设备'}"请求配对，请输入配对码`,
        showCancel: false,
        confirmText: '确定',
        success: () => {
          // 用户点击确定后再显示输入框
          this.setData({
            showPairCodeInput: true,
            pendingDeviceId: deviceId,
            pairCode: '',
            isPairing: true,
            receivedPairRequest: true,
            pairRequestTimestamp: requestData.timestamp,
            connectionStatus: `来自 ${requestData.deviceName || '未知设备'} 的连接请求`
          });
          
          console.log('[配对] 已显示配对码输入框');
          
          // 尝试震动提醒（如果平台支持）
          try {
            wx.vibrateLong();
          } catch (e) {
            // 忽略不支持的平台
          }
        }
      });
    } catch (error) {
      console.error('[配对] 解析配对请求失败:', error);
    }
  },

  async onLoad() {
    try {
      console.log('[Page] 页面加载开始...');
      
      // 初始化 NetworkManager
      this.networkManager = new NetworkManager();
      
      // 设置网络管理器回调
      this.setupNetworkCallbacks();

// 设置配对请求回调
this.networkManager.onPairRequest = (request, remoteInfo, socket) => {
    console.log('[配对] 收到配对请求回调:', request);
    // 处理UDP配对请求
    this.handleUDPPairRequest(request, remoteInfo, socket);
};

// 配对响应回调 - 增强版
this.networkManager.onPairResponse = (response, remoteInfo) => {
    console.log('[配对] 收到配对响应:', response);
    if (response && this.data.pendingDeviceId) {
        // 确保方法存在
        if (typeof this.handlePairResponseWifi === 'function') {
            this.handlePairResponseWifi(this.data.pendingDeviceId, response);
        } else {
            console.error('[配对] handlePairResponseWifi方法不存在');
            // 尝试基本处理
            wx.hideLoading();
            if (response.success) {
                // 创建一个临时设备
                let tempDevice = null;
                
                // 尝试从NetworkManager中查找设备
                if (this.networkManager && response.fromDeviceId) {
                    const remoteDevice = this.networkManager.lanDevices.get(response.fromDeviceId);
                    if (remoteDevice) {
                        tempDevice = {
                            deviceId: remoteDevice.deviceId,
                            name: remoteDevice.name || remoteDevice.deviceName || '远程设备',
                            address: remoteDevice.address,
                            via: 'wifi',
                            RSSI: -50
                        };
                    }
                }
                
                // 如果找不到设备，创建临时设备
                if (!tempDevice && remoteInfo) {
                    tempDevice = {
                        deviceId: response.deviceId || response.fromDeviceId || 'temp-device',
                        name: '远程设备',
                        address: remoteInfo.address,
                        via: 'wifi',
                        RSSI: -50
                    };
                }
                
                if (tempDevice) {
                    this.setData({
                        isPairing: false,
                        sentPairRequest: false,
                        connectedUser: tempDevice,
                        transferStatus: 'connected',
                        connectionStatus: `已连接到 ${tempDevice.name}`
                    });
                }
                
                wx.showToast({ title: '配对成功', icon: 'success' });
            } else {
                wx.showToast({ title: '配对失败', icon: 'none' });
            }
        }
    } else {
        console.warn('[配对] 收到响应但无法处理:', response);
    }
};
      
      // 初始化配对监听器
      if (this.networkManager.initPairingListener) {
        this.networkManager.initPairingListener();
      }
      
      // 获取网络信息
      const networkInfo = await NetworkManager.getNetworkType();
      this.setData({ networkInfo });
      
      // 初始化蓝牙
      await this.initializeBluetoothTransfer();
      console.log('[Page] 蓝牙初始化完成');

        wx.onNetworkStatusChange(async (res) => {
            await this.checkConnectionStatus();
        });

        wx.onBluetoothAdapterStateChange(async (res) => {
            await this.checkConnectionStatus();
        });

      // 监听蓝牙状态变化
      wx.onBLEConnectionStateChange((res) => {
        console.log('[Page] 蓝牙连接状态变化:', res);
        if (!res.connected && this.data.connectedUser) {
          wx.showToast({ title: '连接已断开', icon: 'none' });
          this.setData({ 
            connectedUser: null,
            transferStatus: 'disconnected'
          });
          this.handleDisconnection();
        }
      });
    } catch (error) {
      console.error('[Page] 初始化失败:', error);
      wx.showToast({ 
        title: '初始化失败，请检查设备权限', 
        icon: 'none' 
      });
    }
  },

  setupNetworkCallbacks() {
    // 设备发现回调
    this.networkManager.onLANDeviceFound = (devices) => {
        const currentDevices = [...this.data.nearbyUsers];
        
        // 合并蓝牙和LAN设备列表，避免重复和过滤自己
        devices.forEach(lanDevice => {
          // 不添加自己的设备
          if (lanDevice.deviceId === this.networkManager.deviceId) {
            console.log('[设备发现] 跳过本机设备:', lanDevice);
            return;
          }
          
          const existingIndex = currentDevices.findIndex(
            device => device.deviceId === lanDevice.deviceId
          );
          
          if (existingIndex === -1) {
            console.log('[设备发现] 添加新发现的设备:', lanDevice);
            currentDevices.push({
              ...lanDevice,
              RSSI: -50, // 默认信号强度
              isEnhanced: false
            });
          }
        });
        
        this.setData({ nearbyUsers: currentDevices });
    };
  
    this.networkManager.onReceiveStart = (fileName, fileSize) => {
        // 显示通知
        wx.showToast({
            title: '正在接收文件...',
            icon: 'loading',
            duration: 2000
        });
        
        // 更新UI状态
        this.setData({
            isReceiving: true,
            totalSize: fileSize,
            receivedSize: 0,
            transferStatus: 'receiving',
            transferProgress: 0
        });
    };

    // 传输进度回调
    this.networkManager.onProgress = (progress, transferredSize) => {
        this.setData({ transferProgress: progress });
        this.updateTransferStats(transferredSize);
    };

    // 修改文件接收完成回调
    this.networkManager.onComplete = (result) => {
        try {
            if (!result || !result.path) {
                console.error('[文件接收] 接收到无效的完成回调结果');
                return;
            }

            // 检查是否是重复的文件，使用数组方法而不是 Set
            const fileKey = `${result.name}_${result.size}_${result.transferId}`;
            if (this.data.receivedFileHistory.includes(fileKey)) {
                console.log('[文件接收] 检测到重复文件，跳过处理:', fileKey);
                return;
            }

            // 更新传输状态
            this.setData({ 
                transferStatus: 'completed',
                transferProgress: 100,
                selectedFile: null  // 重要：清除选中的文件
            });

            // 记录此次接收的文件
            const newHistory = [...this.data.receivedFileHistory, fileKey];
            const newFileInfo = {
                path: result.path,
                name: result.name,
                size: result.size,
                timestamp: Date.now()
            };

            this.setData({
                receivedFileHistory: newHistory,
                receivedFiles: [...this.data.receivedFiles, newFileInfo],
                currentReceivedFile: newFileInfo
            });

            const innerAudioContext = wx.createInnerAudioContext();
            innerAudioContext.src = '/assets/audio/notification.mp3';
            innerAudioContext.play();
            
            try {
                wx.vibrateLong();
            } catch (e) {
                // 忽略不支持的平台
            }

            // 显示保存对话框
            wx.showModal({
                title: '传输完成',
                content: `收到文件"${result.name}"，大小: ${this.formatFileSize(result.size)}`,
                confirmText: '保存',
                cancelText: '关闭',
                success: (res) => {
                    if (res.confirm) {
                        // 保存文件
                        this.saveFileToUserAccessible(result.path, result.name)
                            .then(() => {
                                wx.showToast({
                                    title: '文件已保存',
                                    icon: 'success'
                                });
                            })
                            .catch(error => {
                                console.error('[文件接收] 保存文件失败:', error);
                                wx.showToast({
                                    title: '保存失败',
                                    icon: 'none'
                                });
                            });
                    }
                    
                    // 无论保存与否，都清除当前文件状态
                    this.setData({ currentReceivedFile: null });
                }
            });

            // 设置30秒后清理历史记录
            setTimeout(() => {
                const history = this.data.receivedFileHistory;
                const index = history.indexOf(fileKey);
                if (index > -1) {
                    history.splice(index, 1);
                    this.setData({ receivedFileHistory: history });
                }
            }, 30000);

        } catch (error) {
            console.error('[文件接收] 处理完成回调时出错:', error);
            this.setData({ 
                transferStatus: 'error',
                selectedFile: null  // 出错时也要清除选中的文件
            });
        }
    };

    // 添加传输状态更新回调
    this.networkManager.onTransferStatusUpdate = (statusInfo) => {
        console.log('[调试] onTransferStatusUpdate被调用:', statusInfo);
        
        if (statusInfo.status === 'completed') {
            this.setData({
                transferStatus: 'completed',
                transferProgress: 100,
                selectedFile: null  // 清除选中的文件
            });
        }
    };

    // 错误处理回调
    this.networkManager.onError = (error) => {
        wx.showToast({ 
            title: error.message || '传输出错', 
            icon: 'none' 
        });
        this.setData({ transferStatus: 'error' });
    };

  
    // 断开连接回调
    this.networkManager.onConnectionLost = (deviceInfo) => {
        console.log('[连接] 收到设备断开连接通知:', deviceInfo);
        
        // 无论是否为当前连接的设备，都强制断开
        if (this.data.connectedUser) {
            // 清除连接状态
            this.setData({
                connectedUser: null,
                connectionStatus: '',
                transferStatus: 'disconnected'
            });
            
            // 重置导航栏标题
            wx.setNavigationBarTitle({
                title: '面对面快传'
            });
            
            // 显示提示
            wx.showToast({
                title: '连接已断开',
                icon: 'none'
            });
        }
    };
  
    // 取消配对回调
    this.networkManager.onPairCancel = (message) => {
        // 如果正在显示配对弹窗，则关闭
        if (this.data.showPairCodeInput) {
            // 判断是否是自己发起的配对
            const isSender = this.data.sentPairRequest;
            // 判断消息是否来自自己
            const isFromSelf = message.deviceId === this.networkManager.deviceId;
            
            this.setData({
                showPairCodeInput: false,  
                pairCode: '',
                isPairing: false,
                pendingDeviceId: '',
                pairingStatus: ''
            });
            
            // 根据不同情况显示不同提示
            if (isFromSelf) {
                // 是自己取消的
                wx.showToast({
                    title: '您已取消配对',
                    icon: 'none'
                });
            } else {
                // 是对方取消的
                wx.showToast({
                    title: '对方已取消配对',
                    icon: 'none'  
                });
            // 可以尝试震动提醒
                try {
                    wx.vibrateLong();
                } catch(e) {
                    // 忽略不支持的平台
                }
            }
        }
    };
        // 添加传输状态更新回调
    this.networkManager.onTransferStatusUpdate = (statusInfo) => {
        console.log('[调试] onTransferStatusUpdate被调用:', {
            info: statusInfo,
            currentState: {
                selectedFile: !!this.data.selectedFile,
                fileName: this.data.selectedFile?.name,
                transferStatus: this.data.transferStatus
            }
        });
        
        // 重要：不要检查选中的文件，因为这会阻止状态更新
        // 只检查传输状态，确保任何准备中或传输中的文件都能更新状态
        if (statusInfo.status === 'completed' && 
            (this.data.transferStatus === 'preparing' || 
            this.data.transferStatus === 'transferring')) {
            
            // 更新界面状态
            this.setData({
                transferStatus: 'completed',
                transferProgress: 100
            });
            
            // 显示提示
            wx.showToast({
                title: '传输完成',
                icon: 'success'
            });
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
        } catch (error) {
            console.log('蓝牙不可用');
        }

        let mode = 'none';
        if (isBluetoothAvailable && isWifiAvailable) {
            mode = 'both';
        } else if (isBluetoothAvailable) {
            mode = 'bluetooth';
        } else if (isWifiAvailable) {
            mode = 'wifi';
        }

        this.setData({ transferMode: mode });
        return mode;
    } catch (error) {
        console.error('状态检查失败:', error);
        this.setData({ transferMode: 'none' });
        return 'none';
    }
},

async initializeBluetoothTransfer() {
    try {
        // 检查WiFi状态
        const networkInfo = await wx.getNetworkType();
        const isWifiAvailable = networkInfo.networkType === 'wifi';
        
        // 检查蓝牙状态
        let isBluetoothAvailable = false;
        try {
            await wx.openBluetoothAdapter();
            isBluetoothAvailable = true;
        } catch (error) {
            console.log('蓝牙不可用');
        }

        // 设置传输模式
        let mode = 'none';
        if (isBluetoothAvailable && isWifiAvailable) {
            mode = 'both';
        } else if (isBluetoothAvailable) {
            mode = 'bluetooth';
        } else if (isWifiAvailable) {
            mode = 'wifi';
        }

        this.setData({ transferMode: mode });
    } catch (error) {
        console.error('初始化失败:', error);
        this.setData({ transferMode: 'none' });
    }
},

async handleSearchNearby() {
    if (this.data.isSearching) {
        await this.stopSearch();
        return;
    }

    try {
        // 重新初始化
        await this.initializeBluetoothTransfer(); // 重新初始化蓝牙
        await this.checkConnectionStatus();        // 检查连接状态
        
        if (this.data.transferMode === 'none') {
            wx.showToast({
                title: '请确保WiFi或蓝牙已开启',
                icon: 'none'
            });
            return;
        }

        this.setData({ 
            isSearching: true, 
            nearbyUsers: [],
            isEnhancedMode: false
        });

        // 重新初始化网络管理器
        await this.networkManager.initDiscovery();

        // 如果蓝牙可用，重新启动蓝牙搜索
        if (this.data.transferMode === 'bluetooth' || this.data.transferMode === 'both') {
            await this.startDeviceDiscovery();
        }
    } catch (error) {
        console.error('搜索失败:', error);
        wx.showToast({ 
            title: error.message || '搜索失败', 
            icon: 'none' 
        });
        this.setData({ isSearching: false });
    }
},

async startDeviceDiscovery() {
    try {
        const options = this.data.isEnhancedMode 
            ? {
                allowDuplicatesKey: false,
                interval: 0,
                powerLevel: 'high'
            }
            : { 
                allowDuplicatesKey: false,
                services: [SERVICE_UUID]
            };

        await wx.stopBluetoothDevicesDiscovery();
        await wx.startBluetoothDevicesDiscovery(options);
        
        wx.onBluetoothDeviceFound((res) => {
            res.devices.forEach(device => {
                // 检查设备是否已存在
                const existingIndex = this.data.nearbyUsers.findIndex(
                    d => d.deviceId === device.deviceId
                );

                if (this.data.isEnhancedMode) {
                    // 增强模式：允许添加任何设备
                    const newDevice = {
                        deviceId: device.deviceId,
                        name: device.name || device.localName || '未知设备',
                        RSSI: device.RSSI,
                        isEnhanced: true,
                        via: 'bluetooth'
                    };

                    if (existingIndex === -1) {
                        // 设备不存在，直接添加
                        this.setData({
                            nearbyUsers: [...this.data.nearbyUsers, newDevice]
                        });
                    }
                } else {
                    // 普通模式：只添加符合条件的设备
                    if (!device.advertisData) return;
                    try {
                        const advertisData = new Uint8Array(device.advertisData);
                        const view = new DataView(advertisData.buffer);
                        
                        if (view.getUint16(0, true) === MANUFACTURER_ID) {
                            const appCode = String.fromCharCode(
                                view.getUint8(2),
                                view.getUint8(3),
                                view.getUint8(4),
                                view.getUint8(5)
                            );
                            
                            if (appCode === APP_CODE) {
                                const newDevice = {
                                    deviceId: device.deviceId,
                                    name: device.name || '未知设备',
                                    RSSI: device.RSSI,
                                    isEnhanced: false,
                                    via: 'bluetooth'
                                };

                                if (existingIndex === -1) {
                                    this.setData({
                                        nearbyUsers: [...this.data.nearbyUsers, newDevice]
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        console.error('解析广播数据失败:', error);
                    }
                }
            });
        });
    } catch (error) {
        console.error('蓝牙搜索失败:', error);
    }
},

async stopSearch() {
    try {
        // 检查蓝牙是否可用再执行蓝牙相关操作
        if (this.data.transferMode === 'bluetooth' || this.data.transferMode === 'both') {
            try {
                const res = await wx.getBluetoothAdapterState();
                if (res.available) {
                    await wx.stopBluetoothDevicesDiscovery();
                    await wx.closeBluetoothAdapter();
                }
            } catch (error) {
                console.log('蓝牙不可用，跳过停止蓝牙搜索');
            }
        }
        
        // 停止 UDP 发现
        if (this.networkManager) {
            await this.networkManager.cleanup();
        }
        
        // 完全重置所有状态
        this.setData({ 
            isSearching: false,
            nearbyUsers: [],
            isEnhancedMode: false,
            transferMode: 'none'
        });
    } catch (error) {
        console.error('停止搜索出错:', error);
        this.setData({ 
            isSearching: false,
            nearbyUsers: [],
            isEnhancedMode: false,
            transferMode: 'none'
        });
    }
},

async toggleEnhancedMode() {
    if (!this.data.isEnhancedMode) {
        // 当用户尝试开启增强模式时，先显示提示
        wx.showModal({
            title: '开启增强模式',
            content: '该模式下会无视所有设备特征码，直接搜索带有蓝牙信号的设备。通常情况下用不到此功能，一般是搜索老旧设备会比较有用。是否开启？',
            confirmText: '开启',
            cancelText: '取消',
            success: async (res) => {
                if (res.confirm) {
                    // 用户确认开启
                    this.setData({
                        isEnhancedMode: true
                    });

                    // 重新开始增强模式的蓝牙搜索
                    await wx.stopBluetoothDevicesDiscovery();
                    await this.startDeviceDiscovery();

                    wx.showToast({
                        title: '已开启增强模式',
                        icon: 'none'
                    });
                }
            }
        });
    } else {
        // 关闭增强模式，清除增强模式发现的设备
        const normalDevices = this.data.nearbyUsers.filter(device => !device.isEnhanced);
        
        this.setData({
            isEnhancedMode: false,
            nearbyUsers: normalDevices
        });

        // 重新开始普通模式的蓝牙搜索
        await wx.stopBluetoothDevicesDiscovery();
        await this.startDeviceDiscovery();

        wx.showToast({
            title: '已关闭增强模式',
            icon: 'none'
        });
    }

    // 重新开始蓝牙搜索
    await wx.stopBluetoothDevicesDiscovery();
    await this.startDeviceDiscovery();
},

handleConnect(e) {
    const deviceId = e.currentTarget.dataset.deviceid;
    const device = this.data.nearbyUsers.find(d => d.deviceId === deviceId);
    
    if (!device) {
      wx.showToast({ 
        title: '设备信息无效', 
        icon: 'none' 
      });
      return;
    }

   
    console.log('[配对] 当前设备信息:', device);
    console.log('[配对] NetworkManager状态:', {
      initialized: !!this.networkManager.udp,
      discoveryPort: this.networkManager.discoveryPort,
      devices: Array.from(this.networkManager.lanDevices.values())
    });

    // 检测平台是否为Windows开发环境
    const systemInfo = wx.getSystemInfoSync();
    const isWindows = systemInfo.platform === 'windows';
    console.log('[配对] 当前平台:', systemInfo.platform);
    
    // 生成4位数配对码
    const pairCode = Math.floor(1000 + Math.random() * 9000).toString();
    this.targetPairCode = pairCode;
    
    console.log('[配对] 生成配对码:', pairCode);
    console.log('[配对] 当前配对状态:', {
        targetPairCode: this.targetPairCode,
        isPairing: this.data.isPairing,
        sentPairRequest: this.data.sentPairRequest
    });
  
    // 显示配对码对话框，但不等待用户操作就发送配对请求
    wx.showModal({
        title: '设备配对',
        content: `配对码：${pairCode}\n已向对方发送连接请求。`,
        showCancel: true,
        cancelText: '取消',
        confirmText: '',  // 隐藏确定按钮
        success: async (res) => {
          if (res.cancel) {
            // 用户点击取消，中断配对过程
            this.cancelOngoingPairing();
            // 通知其他设备取消配对
            if (this.networkManager && this.networkManager.udp) {
              const cancelMessage = {
                type: 'pair_cancel',
                deviceId: this.networkManager.deviceId,
                timestamp: Date.now()
              };
              
              // 广播取消消息
              this.networkManager.udp.send({
                address: '255.255.255.255',
                port: this.networkManager.discoveryPort,
                message: JSON.stringify(cancelMessage)
              });
            }
          }
        }
      });

    // 立即发送配对请求
    try {
      console.log('[配对] 立即发送配对请求，无需用户确认');
      // 根据设备类型选择连接方式
      if (isWindows || device.via === 'wifi' || device.via === 'udp' || device.address) {
        console.log('[配对] 使用WiFi方式配对');
        this.connectWifi(device, pairCode).catch(error => {
          console.error('[配对] WiFi连接失败:', error);
        });
      } else {
        console.log('[配对] 使用蓝牙方式配对');
        this.createBasicConnection(device).then(() => {
          this.sendPairRequest(device.deviceId, pairCode).catch(error => {
            console.error('[配对] 发送配对请求失败:', error);
          });
        }).catch(error => {
          console.error('[配对] 创建蓝牙连接失败:', error);
          wx.showToast({
            title: '蓝牙连接失败: ' + error.message,
            icon: 'none'
          });
        });
      }
      
      this.setData({
        isPairing: true,
        sentPairRequest: true,
        pairDevice: device  // 新增：保存对方设备信息
      });

    } catch (error) {
      console.error('配对请求失败:', error);
      wx.showToast({
        title: '配对请求失败: ' + error.message,
        icon: 'none'
      });
    }
  },
  
  // 发送配对请求函数
  async sendPairRequest(deviceId, pairCode) {
    // 加密配对码 (简单加密，生产环境可用更复杂的方式)
    const encryptedCode = this.encryptPairCode(pairCode);
    
    const pairRequest = {
      type: 'pair_request',
      timestamp: Date.now(),
      deviceName: wx.getSystemInfoSync().brand || '未知设备',
      pairCode: pairCode  
    };
    
    const payload = this.str2ab(JSON.stringify(pairRequest));
    const packet = this.createPacket(PROTOCOL.TYPE.PAIR_REQUEST, payload);
    
    console.log('[配对] 正在发送配对请求...');
    await this.writeBLEValue(packet);
    console.log('[配对] 已发送配对请求，配对码:', pairCode);
    
    // 设置一个超时检测
    setTimeout(() => {
      if (this.data.isPairing && this.data.sentPairRequest) {
        console.log('[配对] 警告：配对请求可能未被接收，对方未显示输入框');
      }
    }, 5000);
  },
  
// WiFi配对方法
async connectWifi(device, pairCode) {
    try {
      console.log('[配对] 使用WiFi发起配对请求，设备信息:', device);
      
      // 设置状态
      this.setData({
        pendingDeviceId: device.deviceId,
        isPairing: true,
        sentPairRequest: true,
        pairingStatus: '等待对方输入配对码...'
      });
      
      // 构建配对请求
      const pairRequest = {
        type: 'pair_request',
        timestamp: Date.now(),
        deviceName: wx.getSystemInfoSync().brand || '未知设备',
        pairCode: pairCode,
        deviceId: device.deviceId
      };
      
      console.log('[配对] 配对请求内容:', pairRequest);
      
      // 尝试通过NetworkManager发送配对请求
      if (this.networkManager) {
        try {
          // 使用NetworkManager的sendPairRequest方法
          await this.networkManager.sendPairRequest(device, pairRequest);
          console.log('[配对] 配对请求已发送');
        } catch (error) {
          console.error('[配对] 通过NetworkManager发送配对请求失败:', error);
          
          // 如果NetworkManager发送失败，尝试直接使用UDP
          if (this.networkManager.udp) {
            try {
              console.log('[配对] 尝试多种方式发送配对请求');
              const messageStr = JSON.stringify(pairRequest);
              
              // 1. 尝试广播到所有设备
              this.networkManager.udp.send({
                address: '255.255.255.255',
                port: this.networkManager.discoveryPort,
                message: messageStr,
                fail: (err) => console.error('[配对] 广播失败:', err),
                success: () => console.log('[配对] 广播成功')
              });
              
              // 2. 尝试直接发送到设备地址
              if (device.address) {
                console.log(`[配对] 尝试直接发送到设备: ${device.address}`);
                this.networkManager.udp.send({
                  address: device.address,
                  port: this.networkManager.discoveryPort,
                  message: messageStr,
                  fail: (err) => console.error(`[配对] 直接发送到${device.address}失败:`, err),
                  success: () => console.log(`[配对] 直接发送到${device.address}成功`)
                });
              }
              
              // 3. 尝试发送到本地广播地址
              if (device.address && device.address.startsWith('192.168.')) {
                const parts = device.address.split('.');
                const broadcastAddress = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
                console.log(`[配对] 尝试发送到本地广播地址: ${broadcastAddress}`);
                this.networkManager.udp.send({
                  address: broadcastAddress,
                  port: this.networkManager.discoveryPort,
                  message: messageStr,
                  fail: (err) => console.error(`[配对] 发送到本地广播地址失败:`, err),
                  success: () => console.log(`[配对] 发送到本地广播地址成功`)
                });
              }
              
              // 4. 特别处理devtools设备
              const devtoolsDevice = Array.from(this.networkManager.lanDevices.values())
                .find(d => d.name === 'devtools' || d.deviceName === 'devtools');
                
              if (devtoolsDevice && devtoolsDevice.address) {
                console.log('[配对] 尝试直接发送到devtools:', devtoolsDevice.address);
                this.networkManager.udp.send({
                  address: devtoolsDevice.address,
                  port: this.networkManager.discoveryPort,
                  message: messageStr,
                  fail: (err) => console.error('[配对] 直接发送到devtools失败:', err),
                  success: () => console.log('[配对] 直接发送到devtools成功')
                });
              }
            } catch (e) {
              console.error('[配对] 手动发送尝试失败:', e);
            }
          } else {
            throw error; // 如果无法发送，抛出错误
          }
        }
      } else {
        // 模拟发送成功，用于开发环境测试
        console.log('[配对] 模拟WiFi发送配对请求 (开发环境)');
        // 模拟收到配对响应
        setTimeout(() => {
          const fakeResponse = {
            success: true,
            timestamp: Date.now()
          };
          this.handlePairResponseWifi(device.deviceId, fakeResponse);
        }, 5000);
      }
    } catch (error) {
      console.error('[配对] WiFi配对请求失败:', error);
      throw error;
    }
  },

  // 基础连接函数
  async createBasicConnection(device) {
    await wx.createBLEConnection({ deviceId: device.deviceId });
    const { services } = await wx.getBLEDeviceServices({ 
      deviceId: device.deviceId 
    });
  
    for (const service of services) {
      const { characteristics } = await wx.getBLEDeviceCharacteristics({
        deviceId: device.deviceId,
        serviceId: service.uuid
      });
  
      const writeChar = characteristics.find(char => 
        char.properties.write || char.properties.writeNoResponse
      );
  
      if (writeChar) {
        this.setData({
          serviceId: service.uuid,
          characteristicId: writeChar.uuid,
          pendingDeviceId: device.deviceId
        });
        
        await this.setupBasicReceiver(device.deviceId);
        return;
      }
    }
  
    throw new Error('未找到可用的传输通道');
  },
  
  // 设置基础接收器
  async setupBasicReceiver(deviceId) {
    try {
      // 先清除可能存在的旧监听器
      try {
        wx.offBLECharacteristicValueChange();
      } catch (e) {
        // 忽略可能的错误
      }
      
      // 添加延时，确保监听器被正确清除
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 重新注册监听器 - 确保使用bind绑定this上下文
      const boundHandler = this.handleBLEValueChange.bind(this);
      wx.onBLECharacteristicValueChange(boundHandler);
      console.log('[配对] 已设置特征值变化监听器');
      
      // 在启用通知前记录一下当前连接状态
      console.log('[配对] 当前连接状态:', {
        deviceId,
        serviceId: this.data.serviceId,
        characteristicId: this.data.characteristicId
      });
      
      // 然后开启通知
      await wx.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId: this.data.serviceId,
        characteristicId: this.data.characteristicId,
        state: true,
        success: () => {
          console.log('[配对] 成功开启特征值通知');
        },
        fail: (err) => {
          console.error('[配对] 开启特征值通知失败:', err);
        }
      });
      
      // 测试监听器是否正常工作
      console.log('[配对] 监听器设置和通知已开启');
    } catch (error) {
      console.error('[配对] 设置基础接收监听失败:', error);
      throw new Error('设置基础接收监听失败');
    }
  },

  generatePairCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  },

  onPairCodeInput(e) {
    const inputCode = e.detail.value;
    this.setData({ pairCode: inputCode });
    
    console.log('[配对] 配对码输入:', {
        inputCode,
        targetCode: this.targetPairCode,
        receivedPairRequest: this.data.receivedPairRequest,
        sentPairRequest: this.data.sentPairRequest,
        isPairing: this.data.isPairing
    });
    
    // 当输入满4位数字时自动验证
    if (inputCode.length === 4) {
        if (this.data.receivedPairRequest) {
            // 接收方：验证输入的配对码与请求中的配对码是否匹配
            if (inputCode === this.targetPairCode) {
                this.confirmPairCode();
            } else {
                wx.showToast({
                    title: '配对码错误',
                    icon: 'error',
                    duration: 1500
                });
                
                setTimeout(() => {
                    this.setData({ pairCode: '' });
                }, 200);
            }
        } else if (this.data.sentPairRequest) {
            // 发送方：验证输入的配对码与生成的配对码是否匹配
            if (inputCode === this.targetPairCode) {
                this.confirmPairCode();
            } else {
                wx.showToast({
                    title: '配对码错误',
                    icon: 'error',
                    duration: 1500
                });
                
                setTimeout(() => {
                    this.setData({ pairCode: '' });
                }, 200);
            }
        }
    }
},

  cancelPairCode() {
    this.setData({ 
      showPairCodeInput: false, 
      pairCode: '', 
      pendingDeviceId: '' 
    });
  },

  initiatePairing(deviceId) {
    if (this.data.currentRole === 'sender') {
      this.targetPairCode = this.generatePairCode();
      wx.showModal({
        title: '配对码',
        content: `请告诉对方配对码：${this.targetPairCode}`,
        success: () => this.setData({ 
          showPairCodeInput: true,
          pendingDeviceId: deviceId
        })
      });
    } else {
      this.setData({ 
        showPairCodeInput: true, 
        pendingDeviceId: deviceId 
      });
    }
  },

  async confirmPairCode() {
    // 验证配对码格式
    if (!this.data.pairCode || this.data.pairCode.length !== 4) {
        wx.showToast({
            title: '请输入4位配对码',
            icon: 'none'
        });
        return;
    }
    
    console.log('[配对] 开始验证配对码:', {
        inputCode: this.data.pairCode,
        targetCode: this.targetPairCode,
        receivedPairRequest: this.data.receivedPairRequest,
        sentPairRequest: this.data.sentPairRequest,
        pendingDeviceId: this.data.pendingDeviceId,
        pairRequestTimestamp: this.data.pairRequestTimestamp
    });

    // 验证配对码是否匹配
    if (this.data.pairCode !== this.targetPairCode) {
        wx.showToast({
            title: '配对码错误',
            icon: 'error'
        });
        this.setData({ pairCode: '' });
        return;
    }
    
    try {
        if ((this.data.connectionMode === 'wifi' || this.data.pendingRemoteInfo) && 
            this.data.pendingRemoteInfo && 
            this.networkManager && 
            this.networkManager.udp
        ) {
            // 使用UDP/WiFi发送响应
            console.log('[配对] 使用UDP/WiFi发送配对响应');
            
            const response = {
                type: 'pair_response',
                success: true,
                timestamp: Date.now(),
                deviceId: this.data.pendingDeviceId,
                fromDeviceId: this.networkManager.deviceId,
                deviceName: wx.getSystemInfoSync().brand || '远程设备',
                pairCode: this.data.pairCode  
            };
            
            console.log('[配对] UDP配对响应内容:', response);
            console.log('[配对] 发送到:', this.data.pendingRemoteInfo);
            
            // 发送响应
            this.networkManager.udp.send({
                address: this.data.pendingRemoteInfo.address,
                port: this.data.pendingRemoteInfo.port,
                message: JSON.stringify(response),
                fail: (err) => {
                    console.error('[配对] 发送UDP配对响应失败:', err);
                    throw new Error('发送配对响应失败:' + (err.errMsg || JSON.stringify(err)));
                },
                success: () => {
                    console.log('[配对] 发送UDP配对响应成功');
                }
            });
            
            // 广播到本地网络以防端口不匹配
            if (this.data.pendingRemoteInfo.address.startsWith('192.168.')) {
                const parts = this.data.pendingRemoteInfo.address.split('.');
                const broadcastAddress = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
                
                this.networkManager.udp.send({
                    address: broadcastAddress,
                    port: this.networkManager.discoveryPort,
                    message: JSON.stringify(response),
                    fail: (err) => console.error('[配对] 广播配对响应失败:', err),
                    success: () => console.log('[配对] 广播配对响应成功')
                });
            }
        } else if (this.data.serviceId && this.data.characteristicId) {
            // 使用蓝牙发送响应
            console.log('[配对] 使用蓝牙发送配对响应');
            const responsePayload = {
                success: true,
                timestamp: Date.now(),
                pairCode: this.data.pairCode 
            };
            
            const payload = this.str2ab(JSON.stringify(responsePayload));
            const packet = this.createPacket(PROTOCOL.TYPE.PAIR_RESPONSE, payload);
            
            await this.writeBLEValue(packet);
        } else {
            throw new Error('无法确定发送配对响应的方式，请检查连接状态');
        }
        
        // 创建设备连接
        let device = this.data.nearbyUsers.find(d => d.deviceId === this.data.pendingDeviceId);
        if (!device && this.networkManager) {
            const remoteDevice = this.networkManager.lanDevices.get(this.data.pendingDeviceId);
            if (remoteDevice) {
                device = {
                    deviceId: remoteDevice.deviceId,
                    name: remoteDevice.name || remoteDevice.deviceName || '远程设备',
                    address: remoteDevice.address,
                    via: 'wifi',
                    RSSI: -50
                };
            }
        }
        
        if (!device && this.data.pendingRemoteInfo) {
            device = {
                deviceId: this.data.pendingDeviceId || 'temp-device-' + Date.now(),
                name: '远程设备',
                address: this.data.pendingRemoteInfo.address,
                via: 'wifi',
                RSSI: -50
            };
        }
        
        if (device) {
            this.setData({
                showPairCodeInput: false,
                pairCode: '',
                isPairing: false,
                connectedUser: device,
                transferStatus: 'connected',
                connectionStatus: `已连接到 ${device.name || '未知设备'}`
            });
            
            wx.showToast({
                title: '配对成功',
                icon: 'success'
            });
            
            wx.setNavigationBarTitle({
                title: `已连接到 ${device.name || '未知设备'}`
            });
        } else {
            throw new Error('无法创建有效的设备连接');
        }
    } catch (error) {
        console.error('[配对] 配对确认失败:', error);
        wx.showToast({
            title: '配对失败: ' + (error.message || '未知错误'),
            icon: 'none'
        });
        this.setData({
            showPairCodeInput: false,
            pairCode: '',
            isPairing: false
        });
    }
},
  
  async cancelPairCode() {
    // 如果是接收方取消，发送拒绝配对的响应
    if (this.data.pendingDeviceId && this.data.receivedPairRequest) {
      await this.rejectPairCode();
    }
    
    this.setData({ 
      showPairCodeInput: false, 
      pairCode: '', 
      pendingDeviceId: '',
      isPairing: false,
      receivedPairRequest: false,
      sentPairRequest: false
    });
  },

// 处理UDP配对请求
async handleUDPPairRequest(request, remoteInfo, socket) {
    try {
      console.log('[配对] 收到UDP配对请求:', request, '来自:', remoteInfo);
      
      // 保存请求中的配对码
      this.targetPairCode = request.pairCode;
      
      console.log('[配对] 保存接收到的配对码:', {
          receivedCode: request.pairCode,
          savedTargetCode: this.targetPairCode
      });
      
      wx.hideLoading();
      
      // 增加平台检测的日志
      const platform = wx.getSystemInfoSync().platform;
      console.log('[配对] 当前平台:', platform, '准备显示配对请求');
      
      if (platform === 'windows' || platform === 'devtools') {
        console.log('⭐⭐⭐在Windows/devtools环境显示配对请求');
        try {
          // 直接显示配对输入界面，无需额外确认
          this.setData({
            showPairCodeInput: true,
            pendingDeviceId: request.deviceId || request.fromDeviceId,
            pendingRemoteInfo: remoteInfo,
            pendingSocket: socket,
            pairCode: '',  // 清空配对码，等待用户输入
            isPairing: true,
            receivedPairRequest: true,
            pairRequestTimestamp: request.timestamp,
            connectionMode: 'wifi',
            connectionStatus: `来自 ${request.deviceName || '未知设备'} 的配对请求`,
            receivedPairCode: request.pairCode,  // 新增字段保存接收到的配对码
            pairDevice: {  // 新增：保存发起方设备信息
                deviceId: request.deviceId || request.fromDeviceId,
                name: request.deviceName,
                address: remoteInfo.address
            }
          });
          
          console.log('[配对] 跳过模态框显示');
        } catch (e) {
          console.error('[配对] 设置配对状态失败:', e);
        }
      } else {
        // 直接显示配对码输入框，跳过确认对话框
        this.setData({
          showPairCodeInput: true,
          pendingDeviceId: request.deviceId || request.fromDeviceId,
          pendingRemoteInfo: remoteInfo,
          pendingSocket: socket,
          pairCode: '',  // 清空配对码，等待用户输入
          isPairing: true,
          receivedPairRequest: true,
          pairRequestTimestamp: request.timestamp,
          connectionMode: 'wifi',
          connectionStatus: `来自 ${request.deviceName || '未知设备'} 的配对请求`,
          receivedPairCode: request.pairCode  // 新增字段保存接收到的配对码
        });
        
        // 尝试震动提醒
        try {
          wx.vibrateLong();
        } catch (e) {
          // 忽略不支持的平台
        }
      }
    } catch (error) {
      console.error('[配对] 处理UDP配对请求失败:', error);
      // 出错时也尝试显示配对输入框
      
      try {
        this.setData({
          showPairCodeInput: true,
          pendingDeviceId: request.deviceId || request.fromDeviceId,
          pendingRemoteInfo: remoteInfo,
          pendingSocket: socket,
          pairCode: '',  // 清空配对码
          isPairing: true,
          receivedPairRequest: true,
          receivedPairCode: request.pairCode  // 新增字段保存接收到的配对码
        });
      } catch (e) {
        console.error('[配对] 紧急显示配对输入框失败:', e);
      }
    }
},
  
  // UDP拒绝配对
  rejectUDPPairCode(socket, remoteInfo) {
    try {
        const response = {
            type: 'pair_response',
            success: true,
            timestamp: Date.now(),
            deviceId: this.data.pendingDeviceId,
            fromDeviceId: this.networkManager.deviceId  // 使用自己的ID
          };
      
      socket.send({
        address: remoteInfo.address,
        port: remoteInfo.port,
        message: JSON.stringify(response)
      });
    } catch (error) {
      console.error('[配对] 发送UDP拒绝配对失败:', error);
    }
  },

  // 1. 简单的配对码加密函数(用于演示，实际可使用更安全的方式)
encryptPairCode(code) {
    // 简单异或加密
    const key = [0x37, 0x92, 0xF6, 0x4D];
    const result = [];
    
    for (let i = 0; i < code.length; i++) {
      result.push(code.charCodeAt(i) ^ key[i % key.length]);
    }
    
    return result;
  },
  
  // 2. 拒绝配对
  async rejectPairCode() {
    try {
      const responsePayload = {
        success: false,
        reason: '对方取消了配对',
        timestamp: Date.now()
      };
      
      const payload = this.str2ab(JSON.stringify(responsePayload));
      const packet = this.createPacket(PROTOCOL.TYPE.PAIR_RESPONSE, payload);
      
      await this.writeBLEValue(packet);
    } catch (error) {
      console.error('[配对] 发送拒绝配对响应失败:', error);
    }
  },
 // ZU_xian's code fingerprint
  async handlePairResponseWifi(deviceId, response) {
    try {
      console.log('[配对] 处理WiFi配对响应:', response, '设备ID:', deviceId);
      console.log('[配对] 本地设备ID:', this.networkManager.deviceId);
      
      wx.hideLoading();
      
      if (!response.success) {
        console.error('[配对] 配对被拒绝:', response.reason || '未知原因');
        wx.showToast({
          title: '配对被拒绝: ' + (response.reason || '未知原因'),
          icon: 'none'
        });
        
        this.setData({
          isPairing: false,
          sentPairRequest: false,
          pendingDeviceId: ''
        });
        return;
      }
      
      // 配对成功，完成连接
      let device = null;
      
      // 优先使用response中的发送方设备信息
      if (response.fromDeviceId && response.fromDeviceId !== this.networkManager.deviceId) {
        console.log('[配对] 尝试通过fromDeviceId查找设备:', response.fromDeviceId);
        device = this.data.nearbyUsers.find(d => d.deviceId === response.fromDeviceId);
        
        if (!device && this.networkManager) {
          const fromDevice = this.networkManager.lanDevices.get(response.fromDeviceId);
          if (fromDevice) {
            device = {
              deviceId: fromDevice.deviceId,
              name: fromDevice.name || fromDevice.deviceName || '远程设备',
              address: fromDevice.address,
              via: 'wifi',
              RSSI: -50
            };
            console.log('[配对] 从NetworkManager找到发送方设备:', device);
          }
        }
      }
      
      // 如果找不到发送方设备，再尝试使用deviceId
      if (!device) {
        console.log('[配对] 尝试通过deviceId查找设备:', deviceId);
        device = this.data.nearbyUsers.find(d => d.deviceId === deviceId);
}
      
      if (!device && this.networkManager) {
        console.log('[配对] 在nearbyUsers中未找到设备，尝试从NetworkManager中查找');
        
        // 尝试通过fromDeviceId查找
        if (response.fromDeviceId && response.fromDeviceId !== this.networkManager.deviceId) {
          const fromDevice = this.networkManager.lanDevices.get(response.fromDeviceId);
          if (fromDevice) {
            device = {
              deviceId: fromDevice.deviceId,
              name: fromDevice.name || fromDevice.deviceName || '远程设备',
              address: fromDevice.address,
              via: 'wifi',
              RSSI: -50
            };
            console.log('[配对] 通过fromDeviceId找到设备:', device);
          }
        }
        
        // 如果还没找到，再尝试通过deviceId查找
        if (!device) {
          const lanDevice = this.networkManager.lanDevices.get(deviceId);
          if (lanDevice) {
            device = {
              deviceId: lanDevice.deviceId,
              name: lanDevice.name || lanDevice.deviceName || '远程设备',
              address: lanDevice.address,
              via: 'wifi',
              RSSI: -50
            };
            console.log('[配对] 从NetworkManager中找到设备:', device);
          }
        }
      }
      
      if (device) {
        this.setData({
          isPairing: false,
          sentPairRequest: false,
          connectedUser: device,
          transferStatus: 'connected',
          connectionStatus: `已连接到 ${device.name || '未知设备'}`
        });
        
        // 同步设备状态
        this.syncDeviceState(device, 'connected');
        
        wx.showToast({
          title: '配对成功',
          icon: 'success'
        });
        
        wx.setNavigationBarTitle({
          title: `已连接到 ${device.name || '未知设备'}`
        });
      } else {
        console.error('[配对] 未找到待连接设备:', deviceId);
        const tempDevice = {
          deviceId: deviceId,
          name: '远程设备',
          via: 'wifi',
          address: response.remoteInfo ? response.remoteInfo.address : 
                  (this.data.pendingRemoteInfo ? this.data.pendingRemoteInfo.address : null)
        };
        
        this.setData({
          isPairing: false,
          sentPairRequest: false,
          connectedUser: tempDevice,
          transferStatus: 'connected',
          connectionStatus: `已连接到远程设备`
        });
        
        // 同步临时设备状态
        this.syncDeviceState(tempDevice, 'connected');
        
        wx.showToast({
          title: '配对成功',
          icon: 'success'
        });
        
        wx.setNavigationBarTitle({
          title: `已连接到远程设备`
        });
      }
    } catch (error) {
      console.error('[配对] 处理WiFi配对响应失败:', error);
      wx.showToast({
        title: '配对失败: ' + (error.message || '未知错误'),
        icon: 'none'
      });
      
      this.setData({
        isPairing: false,
        sentPairRequest: false,
        pendingDeviceId: ''
      });
    }
  },

  async proceedWithConnection(deviceId) {
    const device = this.data.nearbyUsers.find(d => d.deviceId === deviceId);
    if (!device) return;

    try {
        wx.showLoading({ title: '正在连接...' });
        
        if (device.via === 'bluetooth') {
            await this.connectBluetooth(device);
        } else {
            this.setData({
                connectedUser: device,
                transferStatus: 'connected',
                connectionStatus: `已连接到 ${device.name || '未知设备'}`
            });
        }
        
        wx.showToast({ title: '连接成功', icon: 'success' });
    } catch (error) {
        console.error('连接失败:', error);
        wx.showToast({ title: '连接失败', icon: 'none' });
    } finally {
        wx.hideLoading();
    }
},

  async connectBluetooth(device) {
    await wx.createBLEConnection({ deviceId: device.deviceId });
    const { services } = await wx.getBLEDeviceServices({ 
      deviceId: device.deviceId 
    });

    for (const service of services) {
      const { characteristics } = await wx.getBLEDeviceCharacteristics({
        deviceId: device.deviceId,
        serviceId: service.uuid
      });

      const writeChar = characteristics.find(char => 
        char.properties.write || char.properties.writeNoResponse
      );

      if (writeChar) {
        this.setData({
          serviceId: service.uuid,
          characteristicId: writeChar.uuid,
          connectedUser: device,
          transferStatus: 'connected'
        });
        
        await this.setupReceiver(device.deviceId);
        return;
      }
    }

    throw new Error('未找到可用的传输通道');
  },

  async setupReceiver(deviceId) {
    try {
      await wx.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId: this.data.serviceId,
        characteristicId: this.data.characteristicId,
        state: true
      });
  
      // 使用通用的处理函数
      wx.onBLECharacteristicValueChange(this.handleBLEValueChange.bind(this));
    } catch (error) {
      throw new Error('设置接收监听失败');
    }
  },

  async handleUpload() {
    if (!this.data.connectedUser) {
        wx.showToast({ 
            title: '请先连接接收方', 
            icon: 'none' 
        });
        return;
    }

    try {
        // 直接调用文件选择器，不要提前设置状态
        const fileResult = await new Promise((resolve, reject) => {
            wx.chooseMessageFile({
                count: 1,
                type: 'file',
                success: (res) => {
                    console.log('[上传] 文件选择成功:', res);
                    resolve(res);
                },
                fail: (error) => {
                    console.error('[上传] 文件选择失败:', error);
                    reject(error);
                }
            });
        });

        if (!fileResult || !fileResult.tempFiles || !fileResult.tempFiles.length) {
            throw new Error('未获取到文件信息');
        }

        const file = fileResult.tempFiles[0];
        
        // 选择文件成功后再设置准备中状态
        this.setData({
            selectedFile: {...file, originalName: file.name},
            transferStatus: 'preparing',
            lastTransferTime: Date.now(),
            lastTransferSize: 0
        });
        
        // 检查文件大小
        if (file.size > 100 * 1024 * 1024) { // 100MB限制
            wx.showModal({
                title: '文件过大',
                content: '请选择小于100MB的文件',
                showCancel: false
            });
            return;
        }

        // 执行文件传输逻辑...
        console.log('[上传] 准备传输文件...');
        
        // 根据连接方式选择传输方法
        if (this.data.connectedUser.via === 'bluetooth') {
            console.log('[上传] 使用蓝牙传输');
            await this.sendFileViaBluetooth(file);
        } else {
            console.log('[上传] 使用WiFi传输');
            try {
                await this.networkManager.sendFile(file.path, this.data.connectedUser, file);
            } catch (error) {
                console.error('[上传] WiFi传输失败:', error);
                wx.showToast({
                    title: '文件传输失败: ' + (error.message || '未知错误'),
                    icon: 'none',
                    duration: 3000
                });
                return;
            }
        }
        
        // 传输成功的提示
        wx.showToast({
            title: '传输成功',
            icon: 'success'
        });
    } catch (error) {
        console.error('[上传] 文件处理失败:', error);
        wx.showToast({ 
            title: error.message || '文件处理失败',
            icon: 'none',
            duration: 2000
        });
        
        // 恢复状态
        this.setData({
            transferStatus: '',
            selectedFile: null
        });
    }
},

async saveFileToUserAccessible(tempFilePath, fileName) {
    try {
      // 获取系统信息，判断平台
      const systemInfo = wx.getSystemInfoSync();
      console.log('[文件保存] 当前平台:', systemInfo.platform);
      
      // 根据文件类型选择不同的保存方式
      const fileExt = fileName.split('.').pop().toLowerCase();
      
      if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
        // 图片保存到相册
        return await new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({
            filePath: tempFilePath,
            success: resolve,
            fail: (error) => {
              console.error('[文件保存] 保存图片失败:', error);
              reject(error);
            }
          });
        });
      } else if (systemInfo.platform === 'devtools' || systemInfo.platform === 'windows') {
        // 开发工具环境使用特殊处理
        console.log('[文件保存] 开发环境，使用临时存储');
        return tempFilePath; // 开发环境直接返回临时路径
      } else if (systemInfo.platform === 'android' || systemInfo.platform === 'ios') {
        // 移动设备环境
        try {
          // 先尝试使用 saveFileToDisk
          return await new Promise((resolve, reject) => {
            wx.saveFileToDisk({
              filePath: tempFilePath,
              fileName: fileName,
              success: resolve,
              fail: (error) => {
                if (error.errMsg && error.errMsg.includes('function cannot run')) {
                  // 如果不支持 saveFileToDisk，尝试保存到用户文件夹
                  const fs = wx.getFileSystemManager();
                  const savedPath = `${wx.env.USER_DATA_PATH}/saved_${Date.now()}_${fileName}`;
                  
                  fs.copyFile({
                    srcPath: tempFilePath,
                    destPath: savedPath,
                    success: () => {
                      console.log('[文件保存] 已保存到:', savedPath);
                      resolve(savedPath);
                    },
                    fail: (copyError) => {
                      console.error('[文件保存] 复制文件失败:', copyError);
                      reject(copyError);
                    }
                  });
                } else {
                  reject(error);
                }
              }
            });
          });
        } catch (error) {
          console.error('[文件保存] saveFileToDisk 失败:', error);
          
          // 后备方案：保存到用户空间
          const fs = wx.getFileSystemManager();
          const savedPath = `${wx.env.USER_DATA_PATH}/saved_${Date.now()}_${fileName}`;
          
          return await new Promise((resolve, reject) => {
            fs.copyFile({
              srcPath: tempFilePath,
              destPath: savedPath,
              success: () => {
                console.log('[文件保存] 已保存到用户空间:', savedPath);
                resolve(savedPath);
              },
              fail: reject
            });
          });
        }
      } else {
        // 其他平台的后备处理
        console.log('[文件保存] 未知平台，使用通用方法');
        const fs = wx.getFileSystemManager();
        const savedPath = `${wx.env.USER_DATA_PATH}/saved_${Date.now()}_${fileName}`;
        
        return await new Promise((resolve, reject) => {
          fs.copyFile({
            srcPath: tempFilePath,
            destPath: savedPath,
            success: () => resolve(savedPath),
            fail: reject
          });
        });
      }
    } catch (error) {
      console.error('[文件保存] 保存过程出错:', error);
      throw error;
    }
  },

  async sendFileViaBluetooth(file) {
    try {
      wx.showLoading({ title: '准备发送...' });
      
      // 计算文件校验和
      const checksum = await this.calculateFileChecksum(file.path);
      
      const infoPacket = this.createPacket(
        PROTOCOL.TYPE.FILE_INFO,
        this.str2ab(JSON.stringify({
          size: file.size,
          name: file.name,
          checksum,
          timestamp: Date.now(),
          chunks: Math.ceil(file.size / CHUNK_SIZE)
        }))
      );
      await this.writeBLEValue(infoPacket);

      const fileContent = await this.readFile(file.path);
      for (let i = 0; i * CHUNK_SIZE < fileContent.byteLength; i++) {
        const chunkHeader = new DataView(new ArrayBuffer(2));
        chunkHeader.setUint16(0, i);
        
        const chunkData = fileContent.slice(
          i * CHUNK_SIZE,
          (i + 1) * CHUNK_SIZE
        );
        
        const chunkChecksum = await this.calculateBufferChecksum(chunkData);
        const packet = this.createPacket(
          PROTOCOL.TYPE.FILE_DATA,
          this.mergeBuffers(
            chunkHeader.buffer,
            chunkChecksum,
            chunkData
          )
        );
        
        await this.writeBLEValue(packet);
        
        const progress = Math.floor((i + 1) * CHUNK_SIZE / file.size * 100);
        this.setData({
          transferProgress: Math.min(progress, 100),
          transferStatus: 'transferring'
        });

        this.updateTransferStats(i * CHUNK_SIZE);
      }
      
      wx.showToast({ title: '发送完成', icon: 'success' });
    } catch (error) {
      console.error('发送文件失败:', error);
      wx.showToast({ title: '发送失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ 
        transferProgress: 0,
        transferStatus: 'completed'
      });
    }
  },

  updateTransferStats(transferredSize) {
    const now = Date.now();
    const timeDiff = (now - this.data.lastTransferTime) / 1000;
    
    if (timeDiff > 0) {
      const bytesDiff = transferredSize - this.data.lastTransferSize;
      const speed = bytesDiff / timeDiff;
      const remainingBytes = this.data.selectedFile ? 
        (this.data.selectedFile.size - transferredSize) : 0;
      const remainingTime = speed > 0 ? remainingBytes / speed : 0;

      this.setData({
        transferSpeed: this.formatSpeed(speed),
        remainingTime: this.formatTime(remainingTime),
        lastTransferTime: now,
        lastTransferSize: transferredSize
      });
    }
  },

  formatSpeed(bytesPerSecond) {
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let speed = bytesPerSecond;
    let unitIndex = 0;
    
    while (speed >= 1024 && unitIndex < units.length - 1) {
      speed /= 1024;
      unitIndex++;
    }
    
    return `${speed.toFixed(1)} ${units[unitIndex]}`;
  },

  formatTime(seconds) {
    if (seconds < 60) {
      return `${Math.ceil(seconds)}秒`;
    } else if (seconds < 3600) {
      return `${Math.ceil(seconds / 60)}分钟`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.ceil((seconds % 3600) / 60);
      return `${hours}小时${minutes}分钟`;
    }
  },

  // 蓝牙相关辅助函数
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
    const deviceId = this.data.connectedUser ? 
                   this.data.connectedUser.deviceId : 
                   this.data.pendingDeviceId;
                   
    if (!deviceId) {
      console.error('[蓝牙] 写入失败：未找到设备ID');
      throw new Error('未找到设备ID');
    }
    
    for (let i = 0; i < retries; i++) {
      try {
        await new Promise((resolve, reject) => {
          wx.writeBLECharacteristicValue({
            deviceId: deviceId,
            serviceId: this.data.serviceId,
            characteristicId: this.data.characteristicId,
            value,
            success: (res) => {
              console.log('[蓝牙] 写入特征值成功');
              resolve(res);
            },
            fail: (err) => {
              console.error('[蓝牙] 写入特征值失败:', err);
              reject(err);
            }
          });
        });
        return;
      } catch (err) {
        console.warn(`[蓝牙] 写入失败，第${i+1}次重试:`, err);
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, 300)); // 增加重试间隔
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
          for (let i = 0; i < data.length; i++) {
            hash = ((hash << 5) - hash) + data[i];
            hash = hash & hash;
          }
          resolve(hash.toString(16));
        }
      });
    });
  },

  async calculateBufferChecksum(buffer) {
    const data = new Uint8Array(buffer);
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data[i];
      hash = hash & hash;
    }
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
      wx.getFileSystemManager().readFile({
        filePath,
        success: res => resolve(res.data),
        fail: reject
      });
    });
  },

  handleDisconnection() {
    if (this.data.transferStatus === 'transferring') {
      this.setData({
        transferStatus: 'interrupted',
        canResume: true
      });
    }
    
    if (this.data.reconnectAttempts < this.data.maxReconnectAttempts) {
      this.reconnect();
    }
  },

  async reconnect() {
    this.setData({
      reconnectAttempts: this.data.reconnectAttempts + 1
    });

    try {
      await this.proceedWithConnection(this.data.connectedUser.deviceId);
      this.setData({ reconnectAttempts: 0 });
    } catch (error) {
      console.error('重连失败:', error);
    }
  },

  handleDisconnect() {
    wx.showModal({
      title: '取消连接',
      content: '确定要断开与当前设备的连接吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            if (this.data.connectedUser) {
              // 保存当前设备信息用于发送断开消息
              const deviceToDisconnect = this.data.connectedUser;
  
              // 发送断开连接的消息（在重置状态之前发送）
              const disconnectMessage = {
                type: 'device_state',
                deviceId: this.networkManager.deviceId,
                deviceName: wx.getSystemInfoSync().brand || '远程设备',
                state: 'disconnected',
                timestamp: Date.now()
              };
              
              if (this.networkManager && this.networkManager.udp) {
                const messageStr = JSON.stringify(disconnectMessage);
                
                try {
                  // 如果有对方的具体地址，先直接发送
                  if (deviceToDisconnect.address) {
                    await new Promise((resolve, reject) => {
                      this.networkManager.udp.send({
                        address: deviceToDisconnect.address,
                        port: this.networkManager.discoveryPort,
                        message: messageStr,
                        success: resolve,
                        fail: reject
                      });
                    });
                  }
                  
                  // 再广播断开消息
                  await new Promise((resolve, reject) => {
                    this.networkManager.udp.send({
                      address: '255.255.255.255',
                      port: this.networkManager.discoveryPort,
                      message: messageStr,
                      success: resolve,
                      fail: reject
                    });
                  });
                } catch (error) {
                  console.error('[断开] 发送断开消息失败:', error);
                }
              }
  
              // 如果是蓝牙连接，断开蓝牙
              if (deviceToDisconnect.via === 'bluetooth') {
                try {
                  await wx.closeBLEConnection({
                    deviceId: deviceToDisconnect.deviceId
                  });
                } catch (err) {
                  console.warn('[断开] 断开蓝牙连接失败:', err);
                }
              }
  
              // 最后才重置所有状态
              this.setData({
                connectedUser: null,
                connectionStatus: '',
                transferStatus: 'disconnected',
                transferProgress: 0
              });
  
              // 重置导航栏标题
              wx.setNavigationBarTitle({
                title: '面对面快传'
              });
  
              wx.showToast({
                title: '已断开连接',
                icon: 'success'
              });
            }
          } catch (error) {
            console.error('[断开] 断开连接失败:', error);
            wx.showToast({
              title: '断开连接失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  async onUnload() {
    // 先停止搜索
    await this.stopSearch();

    // 如果有连接的设备，断开连接
    if (this.data.connectedUser) {
        if (this.data.connectedUser.via === 'bluetooth') {
            try {
                await wx.closeBLEConnection({ 
                    deviceId: this.data.connectedUser.deviceId 
                });
            } catch (err) {
                console.log('断开蓝牙连接失败:', err);
            }
        }
    }

    // 关闭蓝牙适配器
    try {
        await wx.closeBluetoothAdapter();
    } catch (err) {
        console.log('关闭蓝牙适配器失败:', err);
    }

    // 重置数据
    this.setData({
        receivedFileHistory: [],
        receivedFiles: [],
        currentReceivedFile: null
    });

    // 清理网络管理器
    if (this.networkManager) {
        this.networkManager.cleanup();
    }
},

  simulatePairCodeInput() {
    console.log('[调试] 模拟显示配对码输入框');
    
    this.setData({
      showPairCodeInput: true,
      pendingDeviceId: 'test-device-id',
      pairCode: '',
      isPairing: true,
      receivedPairRequest: true,
      pairRequestTimestamp: Date.now(),
      connectionStatus: `来自 测试设备 的连接请求`
    });
    
    console.log('[调试] 已显示配对码输入框');
  },

// 取消正在进行的配对
async cancelOngoingPairing() {
    try {
        // 如果已连接，断开连接
        if (this.data.pendingDeviceId) {
            if (this.data.transferMode === 'bluetooth' || this.data.transferMode === 'both') {
                try {
                    await wx.closeBLEConnection({
                        deviceId: this.data.pendingDeviceId
                    });
                } catch (error) {
                    console.log('[配对] 断开蓝牙连接失败，可能未建立连接:', error);
                }
            }
        }

        // 发送取消消息
        if (this.networkManager && this.networkManager.udp) {
            const cancelMessage = {
                type: 'pair_cancel',
                deviceId: this.networkManager.deviceId,
                timestamp: Date.now()
            };

            // 如果有配对设备信息，直接发送给对方
            if (this.data.pairDevice && this.data.pairDevice.address) {
                this.networkManager.udp.send({
                    address: this.data.pairDevice.address,
                    port: this.networkManager.discoveryPort,
                    message: JSON.stringify(cancelMessage),
                    success: () => console.log('[配对] 发送取消消息成功'),
                    fail: (err) => console.error('[配对] 发送取消消息失败:', err)
                });
            }

            // 同时也广播取消消息
            this.networkManager.udp.send({
                address: '255.255.255.255',
                port: this.networkManager.discoveryPort,
                message: JSON.stringify(cancelMessage),
                success: () => console.log('[配对] 广播取消消息成功'),
                fail: (err) => console.error('[配对] 广播取消消息失败:', err)
            });
        }

        // 重置所有配对状态
        this.setData({
            isPairing: false,
            sentPairRequest: false,
            pendingDeviceId: '',
            pairingStatus: '',
            showPairCodeInput: false,
            pairDevice: null  // 清除配对设备信息
        });

        wx.hideLoading();
        console.log('[配对] 已取消配对过程');

    } catch (error) {
        console.error('[配对] 取消配对过程出错:', error);
        // 强制重置状态
        this.setData({
            isPairing: false,
            sentPairRequest: false,
            pendingDeviceId: '',
            pairingStatus: '',
            showPairCodeInput: false,
            pairDevice: null
        });

        wx.hideLoading();
    }
},

  simulatePairRequest() {
    const fakeRequest = {
      type: 'pair_request',
      timestamp: Date.now(),
      deviceName: 'Manual Test',
      pairCode: '1234',
      deviceId: 'test-device'
    };
    
    const fakeRemoteInfo = {
      address: '127.0.0.1',
      port: 40000
    };
    
    // 假装我们收到了配对请求
    this.handleUDPPairRequest(fakeRequest, fakeRemoteInfo, this.networkManager.udp);
  }
});

页面构建代码部分
<!-- index.wxml -->
<view class="container">
<!-- 顶部连接状态 -->
<view class="connection-status" wx:if="{{connectedUser}}">
    <view class="status-content">
        <text class="disconnect-btn" bindtap="handleDisconnect">取消连接</text>
    </view>
</view>

<!-- 传输信息栏 -->
<view class="transfer-info-panel" wx:if="{{connectedUser}}">
  <!-- 文件传输信息区域 -->
  <view class="transfer-info-container">
    <!-- 当前/历史文件信息 -->
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
      
      <!-- 传输进度区域 -->
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
    
    <!-- 保存位置信息 -->
    <view class="save-location-section" wx:if="{{currentReceivedFile}}">
      <view class="location-header">
        <text class="location-title">保存位置</text>
        <text class="copy-path" data-path="{{currentReceivedFile.path}}" bindtap="copyFilePath">复制路径</text>
      </view>
      <text class="location-path">{{currentReceivedFile.path}}</text>
    </view>
    
    <!-- 最近接收文件列表 -->
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
    
    <!-- 无文件状态 -->
    <view class="no-transfer-state" wx:if="{{!selectedFile && !currentReceivedFile && receivedFiles.length === 0}}">
      <text class="no-transfer-text">已连接，请点击 + 选择文件发送，或等待接收文件</text>
    </view>
  </view>
</view>

  <!-- 中间的上传按钮 -->
  <view class="upload-container {{isSearching ? 'hidden' : ''}}">
    <view class="upload-button" bindtap="handleUpload">
      <text class="plus-icon">+</text>
    </view>
  </view>

  <!-- 设备列表 -->
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

  <!-- 改进的配对码输入弹窗 -->
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

  <!-- 传输进度 -->
  <view class="transfer-progress" wx:if="{{transferProgress > 0}}">
    <progress percent="{{transferProgress}}" stroke-width="3" activeColor="#e77c8e"/>
    <text class="progress-text">传输进度: {{transferProgress}}%</text>
  </view>

  <!-- 底部按钮组 -->
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

<!-- 搜索加载动画 -->
<view class="search-loading {{isSearching ? 'show' : ''}}">
  <view class="loading-circle"></view>
</view>

<!-- 配对中状态显示组件 -->
<view class="pairing-status" wx:if="{{false}}">
  <view class="pairing-content">
    <view class="pairing-spinner"></view>
    <text class="pairing-text">{{pairingStatus}}</text>
  </view>
</view>

样式表部分
/* index.wxss */
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
    box-shadow: 0 -16rpx 24rpx rgba(0, 0, 0, 0.1); /* 默认黑色阴影 */
    transform: translateY(100%);
    transition: all 0.3s ease-out;
    max-height: 60vh;
    overflow-y: auto;
    z-index: 2;
    opacity: 0.8;
}

/* 搜索状态时显示并使用蓝色阴影 */
.device-list.show {
    transform: translateY(0);
    opacity: 1;
    box-shadow: 0 -20rpx 24rpx rgba(0, 123, 255, 0.226);
}

/* 增强模式激活时使用红色阴影 */
.device-list.show.enhanced {
    box-shadow: 0 -20rpx 24rpx rgba(231, 124, 142, 0.404); /* 使用与 e77c8e 相同的红色，保持透明度一致 */
}
  
.device-list-header {
    margin-top: -2rpx;  /* 调整头部内容的上边距 */
    padding: 20rpx;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}

.enhance-mode-container {
    margin-top: 8rpx;
    position: absolute;
    top: 51rpx;
    left: 255rpx;
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
    z-index: 2; /* 确保底部按钮在抽屉下方 */
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
    display: flex;           /* 添加 flex 布局 */
    align-items: center;     /* 垂直居中 */
    justify-content: center; /* 水平居中 */
    min-width: 56rpx;       /* 设置最小宽度 */
    height: 32rpx;          /* 设置固定高度 */
    line-height: 0;         /* 重置行高 */
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
    padding-top: 10rpx; /* 为设备数量文本添加额外的顶部内边距 */
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

  /* 传输信息栏样式 */
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
  
  /* 文件信息区域 */
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
  
  /* 传输进度区域 */
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
  
  /* 保存位置信息 */
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
  
  /* 最近接收文件列表 */
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
  
  /* 无文件状态 */
  .no-transfer-state {
    padding: 40rpx 0;
    text-align: center;
  }
  
  .no-transfer-text {
    font-size: 28rpx;
    color: #999;
  }
