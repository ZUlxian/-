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
