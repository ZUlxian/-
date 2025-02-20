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