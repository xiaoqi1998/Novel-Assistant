import { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Select, Slider, InputNumber, message, Space, Typography, Spin, Modal, Alert, Grid, Tabs, Tag, Row, Col, theme, List, Popconfirm, Empty } from 'antd';
import { SaveOutlined, DeleteOutlined, ReloadOutlined, InfoCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, ThunderboltOutlined, EditOutlined, WarningOutlined, PictureOutlined, CopyOutlined } from '@ant-design/icons';
import { settingsApi, mcpPluginApi, newApi } from '../services/api';
import type { SettingsUpdate, APIKeyPreset, APIKeyPresetConfig } from '../types';
import { useNavigate } from 'react-router-dom';
import { usageListForFrontend, AI_USAGES } from '../constants/aiUsages';

const { Title, Text } = Typography;
const { Option } = Select;
const { useBreakpoint } = Grid;
const { TextArea } = Input;

export default function SettingsPage() {
  const { token } = theme.useToken();
  const screens = useBreakpoint();
  const isMobile = !screens.md; // md断点是768px
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [modal, contextHolder] = Modal.useModal();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasSettings, setHasSettings] = useState(false);
  const [isDefaultSettings, setIsDefaultSettings] = useState(false);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string; description: string }>>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [modelSearchText, setModelSearchText] = useState('');
  const [testingApi, setTestingApi] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    response_time_ms?: number;
    response_preview?: string;
    error?: string;
    error_type?: string;
    suggestions?: string[];
  } | null>(null);
  const [showTestResult, setShowTestResult] = useState(false);
  const [testingCoverApi, setTestingCoverApi] = useState(false);
  const [coverTestResult, setCoverTestResult] = useState<{
    success: boolean;
    message: string;
    provider?: string;
    model?: string;
  } | null>(null);

  // 预设相关状态
  const [activeTab, setActiveTab] = useState('current');
  // New API 集成状态
  const [newApiEnabled, setNewApiEnabled] = useState(false);
  const [newApiBound, setNewApiBound] = useState(false);
  const [newApiSubscribed, setNewApiSubscribed] = useState(false);
  const [newApiModels, setNewApiModels] = useState<Array<{ id: string; name: string; pricing: { input: number; output: number } }>>([]);
  const [fetchingNewApiModels, setFetchingNewApiModels] = useState(false);

  // 预设相关状态
  const [presets, setPresets] = useState<APIKeyPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string | undefined>();
  const [actionPresetIds, setActionPresetIds] = useState<Record<string, string | null>>({});
  const [actionModelIds, setActionModelIds] = useState<Record<string, string>>({});
  const [editingPreset, setEditingPreset] = useState<APIKeyPreset | null>(null);
  const [isPresetModalVisible, setIsPresetModalVisible] = useState(false);
  const [testingPresetId, setTestingPresetId] = useState<string | null>(null);
  const [savingActionUsage, setSavingActionUsage] = useState<string | null>(null);
  const [presetForm] = Form.useForm();

  const headerBackground = `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorPrimaryHover} 100%)`;

  useEffect(() => {
    loadSettings();
    loadNewApiStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载 New API 状态与模型列表
  const loadNewApiStatus = async () => {
    try {
      const status: any = await newApi.getStatus();
      setNewApiEnabled(!!status.enabled);
      setNewApiBound(!!status.bound);
      setNewApiSubscribed(!!status.is_subscribed);
      if (status.enabled && status.bound) {
        loadNewApiModels();
      }
    } catch (e) {
      // 未启用或未登录，忽略
    }
  };

  const loadNewApiModels = async () => {
    setFetchingNewApiModels(true);
    try {
      const res: any = await newApi.getModels();
      setNewApiModels(res?.models || []);
      setNewApiSubscribed(!!res?.is_subscribed);
    } catch (e) {
      // 错误已处理
    } finally {
      setFetchingNewApiModels(false);
    }
  };

  const handleSwitchNewApiModel = async (modelId: string) => {
    try {
      await newApi.switchModel(modelId);
      message.success(`模型已切换为 ${modelId}`);
      form.setFieldValue('llm_model', modelId);
    } catch (e) {
      // 错误已处理（403 会弹订阅 Modal）
    }
  };

  // New API 启用且已绑定时，隐藏 API 密钥/地址/提供商字段
  const hideNewApiFields = newApiEnabled && newApiBound;

  useEffect(() => {
    if (activeTab === 'presets') {
      loadPresets();
    } else {
      loadSettings();
      setTestResult(null);
      setShowTestResult(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const loadSettings = async () => {
    setInitialLoading(true);
    try {
      const settings = await settingsApi.getSettings();
      form.setFieldsValue({
        ...defaultCoverSettings,
        ...settings,
        cover_api_provider: settings.cover_api_provider || defaultCoverSettings.cover_api_provider,
        cover_api_key: settings.cover_api_key ?? defaultCoverSettings.cover_api_key,
        cover_api_base_url: settings.cover_api_base_url || defaultCoverSettings.cover_api_base_url,
        cover_image_model: settings.cover_image_model || defaultCoverSettings.cover_image_model,
        cover_enabled: settings.cover_enabled ?? defaultCoverSettings.cover_enabled,
      });

      // 判断是否为默认设置（id='0'表示来自.env的默认配置）
      if (settings.id === '0' || !settings.id) {
        setIsDefaultSettings(true);
        setHasSettings(false);
      } else {
        setIsDefaultSettings(false);
        setHasSettings(true);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // 如果404表示还没有设置，使用默认值
      if (error?.response?.status === 404) {
        setHasSettings(false);
        setIsDefaultSettings(true);
        form.setFieldsValue({
          api_provider: 'openai',
          api_base_url: 'http://new-api:3000/v1',
          llm_model: 'deepseek-v4-pro',
          temperature: 0.7,
          max_tokens: 2000,
          ...defaultCoverSettings,
        });
      } else {
        message.error('加载设置失败');
      }
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSave = async (values: SettingsUpdate) => {
    setLoading(true);
    try {
      const normalizedValues: SettingsUpdate = {
        ...values,
        api_key: builtInKeyProviders.includes(values.api_provider || '') ? '' : values.api_key,
      };
      // 检查是否与 MCP 缓存的配置不一致
      const verifiedConfigStr = localStorage.getItem('mcp_verified_config');
      let configChanged = false;
      
      if (verifiedConfigStr) {
        try {
          const verifiedConfig = JSON.parse(verifiedConfigStr);
          configChanged =
            verifiedConfig.provider !== normalizedValues.api_provider ||
            verifiedConfig.baseUrl !== normalizedValues.api_base_url ||
            verifiedConfig.model !== normalizedValues.llm_model;
        } catch (e) {
          console.error('Failed to parse verified config:', e);
        }
      }
      
      await settingsApi.saveSettings(normalizedValues);
      message.success('设置已保存');
      setHasSettings(true);
      setIsDefaultSettings(false);
      
      // 保存后清除测试结果，因为配置可能已变更
      setTestResult(null);
      setShowTestResult(false);
      
      
      // 如果配置发生变化，需要处理 MCP 插件
      if (configChanged) {
        // 清除 MCP 验证缓存
        localStorage.removeItem('mcp_verified_config');
        
        // 检查并禁用所有 MCP 插件
        try {
          const plugins = await mcpPluginApi.getPlugins();
          const activePlugins = plugins.filter(p => p.enabled);
          
          if (activePlugins.length > 0) {
            // 禁用所有插件
            message.loading({ content: '正在禁用 MCP 插件...', key: 'disable_mcp' });
            await Promise.all(activePlugins.map(p => mcpPluginApi.togglePlugin(p.id, false)));
            message.success({ content: '已禁用所有 MCP 插件', key: 'disable_mcp' });
            
            // 显示提示弹窗
            modal.warning({
              title: (
                <Space>
                  <WarningOutlined style={{ color: token.colorWarning }} />
                  <span>API 配置已更改</span>
                </Space>
              ),
              centered: true,
              content: (
                <div style={{ padding: '8px 0' }}>
                  <Alert
                    message="检测到您修改了 API 配置（提供商、地址或模型），为确保 MCP 插件正常工作，系统已自动禁用所有插件。"
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <div style={{
                    padding: 12,
                    background: token.colorInfoBg,
                    border: `1px solid ${token.colorInfoBorder}`,
                    borderRadius: 8
                  }}>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>请完成以下步骤：</Text>
                    <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                      <li>前往 MCP 插件管理页面</li>
                      <li>重新进行"模型能力检查"</li>
                      <li>确认新模型支持 Function Calling 后再启用插件</li>
                    </ol>
                  </div>
                </div>
              ),
              okText: '前往 MCP 页面',
              cancelText: '稍后处理',
              onOk: () => {
                navigate('/mcp-plugins');
              },
            });
          }
        } catch (err) {
          console.error('Failed to disable MCP plugins:', err);
        }
      }
    } catch {
      message.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    modal.confirm({
      title: '重置设置',
      content: '确定要重置为默认值吗？',
      centered: true,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        form.setFieldsValue({
          api_provider: 'openai',
          api_key: '',
          api_base_url: 'https://api.openai.com/v1',
          llm_model: 'deepseek-v4-pro',
          temperature: 0.7,
          max_tokens: 2000,
          ...defaultCoverSettings,
        });
        message.info('已重置为默认值，请点击保存');
      },
    });
  };

  const handleDelete = () => {
    modal.confirm({
      title: '删除设置',
      content: '确定要删除所有设置吗？此操作不可恢复。',
      centered: true,
      okText: '确定',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        setLoading(true);
        try {
          await settingsApi.deleteSettings();
          message.success('设置已删除');
          setHasSettings(false);
          form.resetFields();
        } catch {
          message.error('删除设置失败');
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleTabChange = (newTab: string) => {
    if (newTab === activeTab) return;
    // 仅 'current' 和 'cover' 两个 Tab 使用了 form，切换前检查是否有未保存改动
    if ((activeTab === 'current' || activeTab === 'cover') && form.isFieldsTouched()) {
      modal.confirm({
        title: '未保存的改动',
        content: '当前 Tab 有未保存的改动，切换后将丢失，确认切换？',
        centered: true,
        okText: '丢弃改动',
        cancelText: '继续编辑',
        onOk: () => setActiveTab(newTab),
      });
    } else {
      setActiveTab(newTab);
    }
  };

  const xiaomiMimoDefaultUrl = 'https://token-plan-cn.xiaomimimo.com/v1';
  const builtInKeyProviders = ['xiaomi_mimo'];
  const xiaomiMimoDefaultModels = [
    { value: 'mimo-v2.5', label: 'mimo-v2.5', description: 'Xiaomi MiMo 官方内置推荐模型' },
  ];
  const defaultCoverSettings = {
    cover_enabled: false,
    cover_api_provider: 'gemini',
    cover_api_key: '',
    cover_api_base_url: 'https://generativelanguage.googleapis.com/v1beta',
    cover_image_model: 'gemini-2.0-flash-exp-image-generation',
  };

  const apiProviders = [
    {
      value: 'xiaomi_mimo',
      label: 'Xiaomi MiMo（内置）',
      defaultUrl: xiaomiMimoDefaultUrl,
      defaultModel: xiaomiMimoDefaultModels[0].value,
      builtInKey: true,
    },
    { value: 'openai', label: 'OpenAI Compatible', defaultUrl: 'https://api.openai.com/v1' },
    // { value: 'anthropic', label: 'Anthropic (Claude)', defaultUrl: 'https://api.anthropic.com' },
    { value: 'gemini', label: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  ];

  const selectedProvider = Form.useWatch('api_provider', form);
  const selectedCoverProvider = Form.useWatch('cover_api_provider', form);
  const temperatureValue = Form.useWatch('temperature', form);

  const handleProviderChange = (value: string) => {
    const provider = apiProviders.find(p => p.value === value);
    if (provider) {
      const nextValues: Record<string, string> = {};
      if (provider.defaultUrl) {
        nextValues.api_base_url = provider.defaultUrl;
      }
      if (builtInKeyProviders.includes(provider.value)) {
        nextValues.api_key = '';
        nextValues.llm_model = provider.defaultModel || xiaomiMimoDefaultModels[0].value;
      }
      form.setFieldsValue(nextValues);
    }
    // 清空模型列表，需要重新获取
    setModelOptions([]);
    setModelsFetched(false);
  };

  const coverApiProviders = [
    { value: 'gemini', label: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    { value: 'grok', label: 'Grok', defaultUrl: 'https://api.x.ai/v1' },
  ];

  const handleCoverProviderChange = (value: string) => {
    const provider = coverApiProviders.find(p => p.value === value);
    if (!provider) {
      setCoverTestResult(null);
      return;
    }

    const nextValues: Record<string, string> = {};
    if (provider.defaultUrl) {
      nextValues.cover_api_base_url = provider.defaultUrl;
    }

    form.setFieldsValue(nextValues);
    setCoverTestResult(null);
  };

  const handleCoverTestConnection = async () => {
    const coverApiProvider = form.getFieldValue('cover_api_provider');
    const coverApiKey = form.getFieldValue('cover_api_key');
    const coverApiBaseUrl = form.getFieldValue('cover_api_base_url');
    const coverImageModel = form.getFieldValue('cover_image_model');

    if (!coverApiProvider || !coverApiKey || !coverImageModel) {
      message.warning('请先填写完整的封面图片配置信息');
      return;
    }

    setTestingCoverApi(true);
    setCoverTestResult(null);
    try {
      const result = await settingsApi.testCoverConnection({
        cover_api_provider: coverApiProvider,
        cover_api_key: coverApiKey,
        cover_api_base_url: coverApiBaseUrl,
        cover_image_model: coverImageModel,
      });
      setCoverTestResult(result);
      if (result.success) {
        message.success('封面图片接口测试成功');
      } else {
        message.error(result.message || '封面图片接口测试失败');
      }
    } catch (error) {
      console.error('封面图片接口测试失败:', error);
      setCoverTestResult({
        success: false,
        message: '封面图片接口测试失败',
      });
    } finally {
      setTestingCoverApi(false);
    }
  };

  const handleFetchModels = async (silent: boolean = false) => {
    const apiKey = form.getFieldValue('api_key');
    const apiBaseUrl = form.getFieldValue('api_base_url');
    const provider = form.getFieldValue('api_provider');

    const isBuiltInKeyProvider = builtInKeyProviders.includes(provider);

    if ((!apiKey && !isBuiltInKeyProvider) || !apiBaseUrl) {
      if (!silent) {
        message.warning('请先填写 API 密钥和 API 地址');
      }
      return;
    }

    setFetchingModels(true);
    try {
      const response = await settingsApi.getAvailableModels({
        api_key: isBuiltInKeyProvider ? '' : apiKey,
        api_base_url: apiBaseUrl,
        provider: provider || 'openai'
      });

      setModelOptions(response.models);
      setModelsFetched(true);
      if (!silent) {
        message.success(`成功获取 ${response.count || response.models.length} 个可用模型`);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || '获取模型列表失败';
      if (!silent) {
        message.error(errorMsg);
      }
      setModelOptions([]);
      setModelsFetched(true); // 即使失败也标记为已尝试，避免重复请求
    } finally {
      setFetchingModels(false);
    }
  };

  const handleModelSelectFocus = () => {
    // 如果还没有获取过模型列表，自动获取
    if (!modelsFetched && !fetchingModels) {
      handleFetchModels(true); // silent模式，不显示成功消息
    }
  };

  const handleTestConnection = async () => {
    const apiKey = form.getFieldValue('api_key');
    const apiBaseUrl = form.getFieldValue('api_base_url');
    const provider = form.getFieldValue('api_provider');
    const modelName = form.getFieldValue('llm_model');
    const temperature = form.getFieldValue('temperature');
    const maxTokens = form.getFieldValue('max_tokens');

    const isBuiltInKeyProvider = builtInKeyProviders.includes(provider);

    if ((!apiKey && !isBuiltInKeyProvider) || !apiBaseUrl || !provider || !modelName) {
      message.warning('请先填写完整的配置信息');
      return;
    }

    setTestingApi(true);
    setTestResult(null);

    try {
      const result = await settingsApi.testApiConnection({
        api_key: isBuiltInKeyProvider ? '' : apiKey,
        api_base_url: apiBaseUrl,
        provider: provider,
        llm_model: modelName,
        temperature: temperature,
        max_tokens: maxTokens
      });

      setTestResult(result);
      setShowTestResult(true);

      if (result.success) {
        message.success(`测试成功！响应时间: ${result.response_time_ms}ms`);
      } else {
        message.error('API 测试失败，请查看详细信息');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || '测试请求失败';
      message.error(errorMsg);
      setTestResult({
        success: false,
        message: '测试请求失败',
        error: errorMsg,
        error_type: 'RequestError',
        suggestions: ['请检查网络连接', '请确认后端服务是否正常运行']
      });
      setShowTestResult(true);
    } finally {
      setTestingApi(false);
    }
  };

  // ========== 预设管理函数 ==========

  const loadPresets = async () => {
    setPresetsLoading(true);
    try {
      const response = await settingsApi.getPresets();
      setPresets(response.presets);
      setActivePresetId(response.active_preset_id);
      setActionPresetIds(response.action_preset_ids || {});
      setActionModelIds(response.action_model_ids || {});
    } catch (error) {
      message.error('加载预设失败');
      console.error(error);
    } finally {
      setPresetsLoading(false);
    }
  };

  const showPresetModal = (preset: APIKeyPreset) => {
    // 预设仅使用系统提供的 API 渠道，模型列表来自主「文本模型配置」的 NewAPI 模型列表
    setEditingPreset(preset);
    // 渠道字段继承主配置（系统 API），只允许在系统模型范围内切换模型
    presetForm.setFieldsValue({
      name: preset.name,
      description: preset.description,
      api_provider: form.getFieldValue('api_provider'),
      api_key: form.getFieldValue('api_key'),
      api_base_url: form.getFieldValue('api_base_url'),
      llm_model: preset.config.llm_model,
      temperature: preset.config.temperature,
      max_tokens: preset.config.max_tokens,
      system_prompt: preset.config.system_prompt,
    });
    setIsPresetModalVisible(true);
  };

  const handlePresetCancel = () => {
    setIsPresetModalVisible(false);
    setEditingPreset(null);
    presetForm.resetFields();
  };

  const handlePresetSave = async () => {
    try {
      const values = await presetForm.validateFields();
      // 预设仅使用系统提供的 API 渠道（主配置），不允许单独配置其他厂商
      const mainValues = form.getFieldsValue();
      const isBuiltInKeyProvider = builtInKeyProviders.includes(mainValues.api_provider);
      const config: APIKeyPresetConfig = {
        api_provider: mainValues.api_provider,
        api_key: isBuiltInKeyProvider ? '' : mainValues.api_key,
        api_base_url: mainValues.api_base_url,
        llm_model: values.llm_model,
        temperature: values.temperature,
        max_tokens: values.max_tokens,
        system_prompt: values.system_prompt,
      };

      if (editingPreset) {
        await settingsApi.updatePreset(editingPreset.id, {
          name: values.name,
          description: values.description,
          config,
        });
        message.success('预设已更新');
      }

      handlePresetCancel();
      loadPresets();
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  /** 为指定动作直接设置系统模型（modelId 为空则回退默认），仅使用系统API渠道 */
  const handleActionModelChange = async (usage: string, modelId?: string) => {
    setSavingActionUsage(usage);
    try {
      const normalizedModelId = modelId || undefined;
      await settingsApi.setActionModel(usage, normalizedModelId);
      setActionModelIds((prev) => {
        const next = { ...prev };
        if (normalizedModelId) {
          next[usage] = normalizedModelId;
        } else {
          delete next[usage];
        }
        return next;
      });
      message.success(normalizedModelId ? `已为该动作设置系统模型: ${normalizedModelId}` : '已恢复使用默认模型');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      message.error(error.response?.data?.detail || '设置动作模型失败');
      console.error(error);
    } finally {
      setSavingActionUsage(null);
    }
  };

  const handlePresetDelete = async (presetId: string) => {
    try {
      await settingsApi.deletePreset(presetId);
      message.success('预设已删除');
      loadPresets();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败');
      console.error(error);
    }
  };

  const handlePresetActivate = async (presetId: string, presetName: string) => {
    try {
      await settingsApi.activatePreset(presetId);
      message.success(`已激活预设: ${presetName}`);

      // 激活预设后清除当前配置Tab的测试结果
      setTestResult(null);
      setShowTestResult(false);

      // 清除模型列表缓存，因为API配置可能已变更
      setModelOptions([]);
      setModelsFetched(false);

      loadPresets();
      loadSettings(); // 重新加载当前配置
    } catch (error) {
      message.error('激活失败');
      console.error(error);
    }
  };

  const handlePresetTest = async (presetId: string) => {
    setTestingPresetId(presetId);
    try {
      const result = await settingsApi.testPreset(presetId);
      if (result.success) {
        modal.success({
          title: '测试成功',
          centered: true,
          width: isMobile ? '90%' : 600,
          content: (
            <div style={{ padding: '8px 0' }}>
              <div style={{ marginBottom: 24, padding: 16, background: token.colorSuccessBg, border: `1px solid ${token.colorSuccessBorder}`, borderRadius: 8 }}>
                <Typography.Text strong style={{ color: token.colorSuccess }}>
                  ✓ API 连接正常
                </Typography.Text>
              </div>
              <div style={{ padding: 16, background: token.colorBgLayout, borderRadius: 8, marginBottom: 16 }}>
                <div style={{ marginBottom: 8, fontSize: 14 }}>
                  <Text type="secondary">提供商：</Text>
                  <Text strong>{result.provider?.toUpperCase() || 'N/A'}</Text>
                </div>
                <div style={{ marginBottom: 8, fontSize: 14 }}>
                  <Text type="secondary">模型：</Text>
                  <Text strong>{result.model || 'N/A'}</Text>
                </div>
                {result.response_time_ms !== undefined && (
                  <div style={{ fontSize: 14 }}>
                    <Text type="secondary">响应时间：</Text>
                    <Text strong>{result.response_time_ms}ms</Text>
                  </div>
                )}
              </div>
              <Alert message="预设配置测试通过，可以正常使用" type="success" showIcon />
            </div>
          ),
        });
      } else {
        modal.error({
          title: '测试失败',
          centered: true,
          width: isMobile ? '90%' : 600,
          content: (
            <div style={{ padding: '8px 0' }}>
              <div style={{ marginBottom: 16 }}>
                <Alert message={result.message || 'API 测试失败'} type="error" showIcon />
              </div>
              {result.error && (
                <div style={{ padding: 16, background: token.colorErrorBg, border: `1px solid ${token.colorErrorBorder}`, borderRadius: 8, marginBottom: 16 }}>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>错误信息:</Text>
                  <Text style={{ fontSize: 13, color: token.colorError, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {result.error}
                  </Text>
                </div>
              )}
              {result.suggestions && result.suggestions.length > 0 && (
                <div style={{ padding: 16, background: token.colorWarningBg, border: `1px solid ${token.colorWarningBorder}`, borderRadius: 8, marginBottom: 16 }}>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>💡 建议:</Text>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {result.suggestions.map((s, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ),
        });
      }
    } catch (error) {
      message.error('测试失败');
      console.error(error);
    } finally {
      setTestingPresetId(null);
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'openai':
        return 'blue';
      case 'gemini':
        return 'green';
      default:
        return 'default';
    }
  };

  // ========== 渲染预设列表 ==========

  const renderPresetsList = () => (
    <Spin spinning={presetsLoading}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary">管理你的API配置预设，为不同动作分配专用模型</Text>
        </div>

        <Card size="small" style={{ background: token.colorFillAlter, borderColor: token.colorBorderSecondary }}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space direction="vertical" size={2}>
              <Text strong>按行为动作分配模型</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                为不同动作直接指定系统模型（仅使用系统提供的 API，含价格）；未指定的动作使用默认模型。
              </Text>
            </Space>
            {!newApiSubscribed && (
              <Alert
                showIcon
                type="warning"
                message="非订阅用户所有动作均使用默认模型"
                description="订阅后可为各动作指定不同的系统模型。"
                style={{ padding: '6px 10px' }}
              />
            )}
            {usageListForFrontend().map((group) => (
              <div key={group.group}>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
                  {group.groupLabel}
                </Text>
                <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 4 }}>
                  {group.actions
                    .filter((a) => a.usage !== 'default')
                    .map((action) => (
                      <Row key={action.usage} gutter={[8, 4]} align="middle">
                        <Col xs={24} sm={14} md={13}>
                          <Space direction="vertical" size={0}>
                            <Text style={{ fontSize: 13 }}>{action.label}</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {action.description}
                            </Text>
                          </Space>
                        </Col>
                        <Col xs={24} sm={10} md={11}>
                          <Select
                            allowClear
                            showSearch
                            placeholder="默认模型"
                            optionFilterProp="label"
                            loading={savingActionUsage === action.usage || fetchingNewApiModels}
                            value={actionModelIds[action.usage] || undefined}
                            disabled={
                              presetsLoading ||
                              savingActionUsage === action.usage ||
                              !newApiSubscribed
                            }
                            style={{ width: '100%' }}
                            onChange={(value) => handleActionModelChange(action.usage, value)}
                            options={newApiModels.map((m) => ({
                              value: m.id,
                              label: m.id,
                              pricing: m.pricing,
                            }))}
                            optionRender={(option: any) => (
                              <div>
                                <div style={{ fontWeight: 500 }}>{option.data.value}</div>
                                {option.data.pricing && (
                                  <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                                    价格：输入 ${option.data.pricing.input}/百万tokens · 输出 ${option.data.pricing.output}/百万tokens
                                  </div>
                                )}
                              </div>
                            )}
                            notFoundContent={
                              fetchingNewApiModels ? <div style={{ padding: 8, textAlign: 'center' }}><Spin size="small" /> 加载中...</div> : null
                            }
                          />
                        </Col>
                      </Row>
                    ))}
                </Space>
              </div>
            ))}
          </Space>
        </Card>

        {presets.length === 0 ? (
          <Empty
            description="暂无预设配置（预设由管理员统一维护）"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: '40px 0' }}
          />
        ) : (
          <List
            dataSource={presets}
            renderItem={(preset) => {
              const isActive = preset.id === activePresetId;
              return (
                <List.Item
                  key={preset.id}
                  style={{
                    background: isActive ? token.colorInfoBg : 'transparent',
                    padding: '16px',
                    marginBottom: '8px',
                    border: isActive ? `2px solid ${token.colorPrimary}` : `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: '8px',
                  }}
                  actions={[
                    !isActive && (
                      <Button
                        key="activate"
                        type="link"
                        onClick={() => handlePresetActivate(preset.id, preset.name)}
                      >
                        激活
                      </Button>
                    ),
                    <Button
                      key="test"
                      type="link"
                      icon={<ThunderboltOutlined />}
                      loading={testingPresetId === preset.id}
                      onClick={() => handlePresetTest(preset.id)}
                    >
                      测试
                    </Button>,
                    <Button
                      key="edit"
                      type="link"
                      icon={<EditOutlined />}
                      onClick={() => showPresetModal(preset)}
                    >
                      编辑
                    </Button>,
                    <Popconfirm
                      key="delete"
                      title="确定删除此预设吗？"
                      onConfirm={() => handlePresetDelete(preset.id)}
                      disabled={isActive}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button
                        type="link"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={isActive}
                      >
                        删除
                      </Button>
                    </Popconfirm>,
                  ].filter(Boolean)}
                >
                  <List.Item.Meta
                    avatar={
                      isActive && (
                        <CheckCircleOutlined
                          style={{ fontSize: '24px', color: token.colorSuccess }}
                        />
                      )
                    }
                    title={
                      <Space>
                        <span style={{ fontWeight: 'bold' }}>{preset.name}</span>
                        {isActive && <Tag color="success">激活中</Tag>}
                        {Object.entries(actionPresetIds)
                          .filter(([, pid]) => pid === preset.id)
                          .map(([usage]) => AI_USAGES[usage]?.label)
                          .filter(Boolean)
                          .map((label) => (
                            <Tag key={label as string} color="processing">
                              {label}
                            </Tag>
                          ))}
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        {preset.description && (
                          <div style={{ color: token.colorTextSecondary }}>{preset.description}</div>
                        )}
                        <Space wrap>
                          <Tag color={getProviderColor(preset.config.api_provider)}>
                            {preset.config.api_provider.toUpperCase()}
                          </Tag>
                          <Tag>{preset.config.llm_model}</Tag>
                          <Tag>温度: {preset.config.temperature}</Tag>
                          <Tag>Tokens: {preset.config.max_tokens}</Tag>
                        </Space>
                        <div style={{ fontSize: '12px', color: token.colorTextTertiary }}>
                          创建于: {new Date(preset.created_at).toLocaleString()}
                        </div>
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Space>
    </Spin>
  );

  return (
    <>
      {contextHolder}
      <div>
        <div>
          {/* 顶部导航卡片 */}
          <Card
            variant="borderless"
            style={{
              background: headerBackground,
              borderRadius: isMobile ? 16 : 24,
              boxShadow: token.boxShadowSecondary,
              marginBottom: isMobile ? 20 : 24,
              border: 'none',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {/* 装饰性背景元素 */}
            <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: token.colorWhite, opacity: 0.08, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -40, left: '30%', width: 120, height: 120, borderRadius: '50%', background: token.colorWhite, opacity: 0.05, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: '50%', right: '15%', width: 80, height: 80, borderRadius: '50%', background: token.colorWhite, opacity: 0.06, pointerEvents: 'none' }} />

            <Row align="middle" justify="space-between" gutter={[16, 16]} style={{ position: 'relative', zIndex: 1 }}>
              <Col xs={24} sm={12}>
                <Space direction="vertical" size={4}>
                  <Title level={isMobile ? 3 : 2} style={{ margin: 0, color: token.colorWhite, textShadow: `0 2px 4px ${token.colorBgMask}` }}>
                    AI API 设置
                  </Title>
                  <Text style={{ fontSize: isMobile ? 12 : 14, color: token.colorTextLightSolid, marginLeft: isMobile ? 40 : 48, opacity: 0.85 }}>
                    配置AI接口参数，管理多个API配置预设
                  </Text>
                </Space>
              </Col>
              <Col xs={24} sm={12}>
                {/* 按钮区域预留 */}
              </Col>
            </Row>
          </Card>

          {/* 主内容卡片 */}
          <Card
            variant="borderless"
            style={{
              background: token.colorBgContainer,
              borderRadius: isMobile ? 12 : 16,
              boxShadow: token.boxShadowSecondary,
              flex: 1,
            }}
            styles={{
              body: {
                padding: isMobile ? '16px' : '24px'
              }
            }}
          >
            <Tabs
              activeKey={activeTab}
              onChange={handleTabChange}
              items={[
                {
                  key: 'current',
                  label: <Space size={6}><ThunderboltOutlined />文本模型配置</Space>,
                  children: (
                    <Space direction="vertical" size={isMobile ? 'middle' : 'large'} style={{ width: '100%' }}>

                      {/* 默认配置提示 */}
                      {isDefaultSettings && (
                        <Alert
                          message="使用 .env 文件中的默认配置"
                          description={
                            <div style={{ fontSize: isMobile ? '12px' : '14px' }}>
                              <p style={{ margin: '8px 0' }}>
                                当前显示的是从服务器 <code>.env</code> 文件读取的默认配置。
                              </p>
                              <p style={{ margin: '8px 0 0 0' }}>
                                点击"保存设置"后，配置将保存到数据库并同步更新到 <code>.env</code> 文件。
                              </p>
                            </div>
                          }
                          type="info"
                          showIcon
                          style={{ marginBottom: isMobile ? 12 : 16 }}
                        />
                      )}

                      {/* 已保存配置提示 */}
                      {hasSettings && !isDefaultSettings && (
                        <Alert
                          message="使用已保存的个人配置"
                          type="success"
                          showIcon
                          style={{ marginBottom: isMobile ? 12 : 16 }}
                        />
                      )}

                      {/* 表单 */}
                      <Spin spinning={initialLoading}>
                        <Form
                          form={form}
                          layout="vertical"
                          onFinish={handleSave}
                          autoComplete="off"
                        >
                          {hideNewApiFields && (
                            <Alert
                              type="success"
                              showIcon
                              message="AI 服务已由系统统一管理"
                              description="API 密钥与地址由系统签发，无需手动配置。下方可选择模型，余额与充值请前往「个人中心」。"
                              style={{ marginBottom: 16 }}
                            />
                          )}

                          {!hideNewApiFields && (
                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>API 提供商</span>
                                <InfoCircleOutlined
                                  title="选择你的AI服务提供商"
                                  style={{ color: token.colorTextSecondary, fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="api_provider"
                            rules={[{ required: true, message: '请选择API提供商' }]}
                          >
                            <Select size={isMobile ? 'middle' : 'large'} onChange={handleProviderChange}>
                              {apiProviders.map(provider => (
                                <Option key={provider.value} value={provider.value}>
                                  {provider.label}
                                </Option>
                              ))}
                            </Select>
                          </Form.Item>
                          )}

                          {!hideNewApiFields && selectedProvider === 'xiaomi_mimo' && (
                            <Alert
                              type="info"
                              showIcon
                              message="Xiaomi MiMo 内置适配器"
                              description="使用 OpenAI 兼容格式与内置服务地址。真实 Key 仅由后端环境变量提供，前端和数据库不会保存该 Key。"
                              style={{ marginBottom: 16 }}
                            />
                          )}

                          {!hideNewApiFields && (
                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>API 密钥</span>
                                <InfoCircleOutlined
                                  title="你的API密钥，将加密存储"
                                  style={{ color: token.colorTextSecondary, fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="api_key"
                            rules={builtInKeyProviders.includes(selectedProvider) ? [] : [{ required: true, message: '请输入API密钥' }]}
                          >
                            <Input.Password
                              size={isMobile ? 'middle' : 'large'}
                              placeholder={builtInKeyProviders.includes(selectedProvider) ? '使用后端内置密钥' : 'sk-...'}
                              autoComplete="new-password"
                              disabled={builtInKeyProviders.includes(selectedProvider)}
                            />
                          </Form.Item>
                          )}

                          {!hideNewApiFields && (
                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>API 地址</span>
                                <InfoCircleOutlined
                                  title="API的基础URL地址"
                                  style={{ color: token.colorTextSecondary, fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="api_base_url"
                            rules={[
                              { required: true, message: '请输入API地址' },
                              { type: 'url', message: '请输入有效的URL' }
                            ]}
                          >
                            <Input
                              size={isMobile ? 'middle' : 'large'}
                              placeholder="https://api.openai.com/v1"
                            />
                          </Form.Item>
                          )}

                          {hideNewApiFields ? (
                            <Form.Item
                              label={
                                <Space size={4}>
                                  <span>模型</span>
                                  {!newApiSubscribed && <Tag color="default">订阅后可切换</Tag>}
                                  <InfoCircleOutlined
                                    title="模型由系统提供，非订阅用户仅可用默认模型"
                                    style={{ color: token.colorTextSecondary, fontSize: isMobile ? '12px' : '14px' }}
                                  />
                                </Space>
                              }
                              name="llm_model"
                              rules={[{ required: true, message: '请选择模型' }]}
                            >
                              <Select
                                size={isMobile ? 'middle' : 'large'}
                                showSearch
                                placeholder="选择模型"
                                optionFilterProp="label"
                                loading={fetchingNewApiModels}
                                disabled={!newApiSubscribed}
                                onChange={(val) => handleSwitchNewApiModel(val)}
                                options={newApiModels.map(m => ({
                                  value: m.id,
                                  label: m.id === form.getFieldValue('llm_model') ? `${m.id}（当前）` : m.id,
                                  pricing: m.pricing,
                                }))}
                                optionRender={(option: any) => (
                                  <div>
                                    <div style={{ fontWeight: 500 }}>{option.data.value}</div>
                                    {option.data.pricing && (
                                      <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                                        价格：输入 ${option.data.pricing.input}/百万tokens · 输出 ${option.data.pricing.output}/百万tokens
                                      </div>
                                    )}
                                  </div>
                                )}
                                notFoundContent={
                                  fetchingNewApiModels ? <div style={{ padding: 8, textAlign: 'center' }}><Spin size="small" /> 加载中...</div> : null
                                }
                              />
                            </Form.Item>
                          ) : (
                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>模型名称</span>
                                <InfoCircleOutlined
                                  title="AI模型的名称，如 gpt-4, gpt-3.5-turbo"
                                  style={{ color: token.colorTextSecondary, fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="llm_model"
                            rules={[{ required: true, message: '请输入或选择模型名称' }]}
                          >
                            <Select
                              size={isMobile ? 'middle' : 'large'}
                              showSearch
                              placeholder={isMobile ? "输入或选择模型" : "输入模型名称或点击获取"}
                              optionFilterProp="label"
                              loading={fetchingModels}
                              onFocus={handleModelSelectFocus}
                              onSearch={(value) => setModelSearchText(value)}
                              onSelect={() => setModelSearchText('')}
                              onBlur={() => setModelSearchText('')}
                              filterOption={(input, option) => {
                                // 手动输入的选项始终显示
                                if (option?.value === input && !modelOptions.some(m => m.value === input)) return true;
                                return (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                                  (option?.description ?? '').toLowerCase().includes(input.toLowerCase());
                              }}
                              dropdownRender={(menu) => (
                                <>
                                  {menu}
                                  {fetchingModels && (
                                    <div style={{ padding: '8px 12px', color: token.colorTextSecondary, textAlign: 'center', fontSize: isMobile ? '12px' : '14px' }}>
                                      <Spin size="small" /> 正在获取模型列表...
                                    </div>
                                  )}
                                  {!fetchingModels && modelOptions.length === 0 && modelsFetched && !modelSearchText && (
                                    <div style={{ padding: '8px 12px', color: token.colorError, textAlign: 'center', fontSize: isMobile ? '12px' : '14px' }}>
                                      未能获取到模型列表，可直接输入模型名称
                                    </div>
                                  )}
                                  {!fetchingModels && modelOptions.length === 0 && !modelsFetched && !modelSearchText && (
                                    <div style={{ padding: '8px 12px', color: token.colorTextSecondary, textAlign: 'center', fontSize: isMobile ? '12px' : '14px' }}>
                                      点击输入框自动获取，或直接输入模型名称
                                    </div>
                                  )}
                                </>
                              )}
                              notFoundContent={
                                fetchingModels ? (
                                  <div style={{ padding: '8px 12px', textAlign: 'center', fontSize: isMobile ? '12px' : '14px' }}>
                                    <Spin size="small" /> 加载中...
                                  </div>
                                ) : null
                              }
                              suffixIcon={
                                !isMobile ? (
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!fetchingModels) {
                                        setModelsFetched(false);
                                        handleFetchModels(false);
                                      }
                                    }}
                                    style={{
                                      cursor: fetchingModels ? 'not-allowed' : 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      padding: '0 4px',
                                      height: '100%',
                                      marginRight: -8
                                    }}
                                    title="重新获取模型列表"
                                  >
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<ReloadOutlined />}
                                      loading={fetchingModels}
                                      style={{ pointerEvents: 'none' }}
                                    >
                                      刷新
                                    </Button>
                                  </div>
                                ) : undefined
                              }
                              options={(() => {
                                const providerDefaultModels = selectedProvider === 'xiaomi_mimo' ? xiaomiMimoDefaultModels : [];
                                const combinedModels = [
                                  ...providerDefaultModels,
                                  ...modelOptions.filter(model => !providerDefaultModels.some(item => item.value === model.value)),
                                ];
                                const opts = combinedModels.map(model => ({
                                  value: model.value,
                                  label: model.label,
                                  description: model.description
                                }));
                                // 如果用户输入了文本且不在已有选项中，添加手动输入选项
                                if (modelSearchText && !modelOptions.some(m =>
                                  m.value.toLowerCase() === modelSearchText.toLowerCase() ||
                                  m.label.toLowerCase() === modelSearchText.toLowerCase()
                                )) {
                                  opts.unshift({
                                    value: modelSearchText,
                                    label: modelSearchText,
                                    description: '手动输入的模型名称'
                                  });
                                }
                                return opts;
                              })()}
                              optionRender={(option) => (
                                <div>
                                  <div style={{ fontWeight: 500, fontSize: isMobile ? '13px' : '14px' }}>
                                    {option.data.description === '手动输入的模型名称' ? (
                                      <Space size={4}>
                                        <EditOutlined style={{ color: token.colorPrimary }} />
                                        <span>使用 "{option.data.label}"</span>
                                      </Space>
                                    ) : option.data.label}
                                  </div>
                                  {option.data.description && option.data.description !== '手动输入的模型名称' && (
                                    <div style={{ fontSize: isMobile ? '11px' : '12px', color: token.colorTextTertiary, marginTop: '2px' }}>
                                      {option.data.description}
                                    </div>
                                  )}
                                </div>
                              )}
                            />
                          </Form.Item>
                          )}

                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>温度参数</span>
                                <InfoCircleOutlined
                                  title="控制输出的随机性，值越高越随机（0.0-2.0）"
                                  style={{ color: token.colorTextSecondary, fontSize: isMobile ? '12px' : '14px' }}
                                />
                                {temperatureValue !== undefined && temperatureValue !== null && (
                                  <Text type="secondary" style={{ fontSize: isMobile ? '12px' : '13px' }}>
                                    温度：{Number(temperatureValue).toFixed(1)}
                                  </Text>
                                )}
                              </Space>
                            }
                            name="temperature"
                          >
                            <Slider
                              min={0}
                              max={2}
                              step={0.1}
                              marks={{
                                0: { style: { fontSize: isMobile ? '11px' : '12px' }, label: '0.0' },
                                0.7: { style: { fontSize: isMobile ? '11px' : '12px' }, label: '0.7' },
                                1: { style: { fontSize: isMobile ? '11px' : '12px' }, label: '1.0' },
                                2: { style: { fontSize: isMobile ? '11px' : '12px' }, label: '2.0' }
                              }}
                            />
                          </Form.Item>

                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>最大 Token 数</span>
                                <InfoCircleOutlined
                                  title="单次请求的最大token数量"
                                  style={{ color: token.colorTextSecondary, fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="max_tokens"
                            rules={[
                              { required: true, message: '请输入最大token数' },
                              { type: 'number', min: 1, message: '请输入大于0的数字' }
                            ]}
                          >
                            <InputNumber
                              size={isMobile ? 'middle' : 'large'}
                              style={{ width: '100%' }}
                              min={1}
                              placeholder="2000"
                            />
                          </Form.Item>

                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>系统提示词</span>
                                <InfoCircleOutlined
                                  title="设置全局系统提示词，每次AI调用时都会自动使用。可用于设定AI的角色、语言风格等"
                                  style={{ color: token.colorTextSecondary, fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="system_prompt"
                            extra={
                              <Text type="secondary" style={{ fontSize: isMobile ? '12px' : '13px' }}>
                                支持变量：{'{{project_name}}'} 项目名、{'{{chapter_title}}'} 章节标题、{'{{character_name}}'} 角色名
                              </Text>
                            }
                          >
                            <TextArea
                              rows={4}
                              placeholder="例如：你是一个专业的小说创作助手，请用生动、细腻的文字进行创作..."
                              maxLength={10000}
                              showCount
                              style={{ fontSize: isMobile ? '13px' : '14px' }}
                            />
                          </Form.Item>

                          {/* 测试结果展示 */}
                          {showTestResult && testResult && (
                            <Alert
                              message={
                                <Space>
                                  {testResult.success ? (
                                    <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: isMobile ? '16px' : '18px' }} />
                                  ) : (
                                    <CloseCircleOutlined style={{ color: token.colorError, fontSize: isMobile ? '16px' : '18px' }} />
                                  )}
                                  <span style={{ fontSize: isMobile ? '14px' : '16px', fontWeight: 500 }}>
                                    {testResult.message}
                                  </span>
                                </Space>
                              }
                              description={
                                <div style={{ marginTop: 8 }}>
                                  {testResult.success ? (
                                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                      {testResult.response_time_ms && (
                                        <div style={{ fontSize: isMobile ? '12px' : '14px' }}>
                                          ⚡ 响应时间: <strong>{testResult.response_time_ms} ms</strong>
                                        </div>
                                      )}
                                      {testResult.response_preview && (
                                        <div style={{
                                          fontSize: isMobile ? '12px' : '13px',
                                          padding: '8px 12px',
                                          background: token.colorSuccessBg,
                                          borderRadius: '4px',
                                          border: `1px solid ${token.colorSuccessBorder}`,
                                          marginTop: '8px'
                                        }}>
                                          <div style={{ marginBottom: '4px', fontWeight: 500 }}>AI 响应预览:</div>
                                          <div style={{ color: token.colorTextSecondary }}>{testResult.response_preview}</div>
                                        </div>
                                      )}
                                      <div style={{ color: token.colorSuccess, fontSize: isMobile ? '12px' : '13px', marginTop: '4px' }}>
                                        ✓ API 配置正确，可以正常使用
                                      </div>
                                    </Space>
                                  ) : (
                                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                      {testResult.error && (
                                        <div style={{
                                          fontSize: isMobile ? '12px' : '13px',
                                          padding: '8px 12px',
                                          background: token.colorErrorBg,
                                          borderRadius: '4px',
                                          border: `1px solid ${token.colorErrorBorder}`,
                                          color: token.colorError
                                        }}>
                                          <strong>错误信息:</strong> {testResult.error}
                                        </div>
                                      )}
                                      {testResult.error_type && (
                                        <div style={{ fontSize: isMobile ? '11px' : '12px', color: token.colorTextSecondary }}>
                                          错误类型: {testResult.error_type}
                                        </div>
                                      )}
                                      {testResult.suggestions && testResult.suggestions.length > 0 && (
                                        <div style={{ marginTop: '8px' }}>
                                          <div style={{ fontSize: isMobile ? '12px' : '13px', fontWeight: 500, marginBottom: '4px' }}>
                                            💡 解决建议:
                                          </div>
                                          <ul style={{
                                            margin: 0,
                                            paddingLeft: isMobile ? '16px' : '20px',
                                            fontSize: isMobile ? '12px' : '13px',
                                            color: token.colorTextSecondary
                                          }}>
                                            {testResult.suggestions.map((suggestion, index) => (
                                              <li key={index} style={{ marginBottom: '4px' }}>{suggestion}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                    </Space>
                                  )}
                                </div>
                              }
                              type={testResult.success ? 'success' : 'error'}
                              closable
                              onClose={() => setShowTestResult(false)}
                              style={{ marginBottom: isMobile ? 16 : 24 }}
                            />
                          )}

                          {/* 操作按钮 */}
                          <Form.Item style={{ marginBottom: 0, marginTop: isMobile ? 24 : 32 }}>
                            {isMobile ? (
                              // 移动端：垂直堆叠布局
                              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                                <Button
                                  type="primary"
                                  size="large"
                                  icon={<SaveOutlined />}
                                  htmlType="submit"
                                  loading={loading}
                                  block
                                  style={{
                                    background: token.colorPrimary,
                                    border: 'none',
                                    height: '44px'
                                  }}
                                >
                                  保存设置
                                </Button>
                                <Button
                                  size="large"
                                  icon={<ThunderboltOutlined />}
                                  onClick={handleTestConnection}
                                  loading={testingApi}
                                  block
                                  style={{
                                    borderColor: token.colorSuccess,
                                    color: token.colorSuccess,
                                    fontWeight: 500,
                                    height: '44px'
                                  }}
                                >
                                  {testingApi ? '测试中...' : '测试连接'}
                                </Button>
                                <Space size="middle" style={{ width: '100%' }}>
                                  <Button
                                    size="large"
                                    icon={<ReloadOutlined />}
                                    onClick={handleReset}
                                    style={{ flex: 1, height: '44px' }}
                                  >
                                    重置
                                  </Button>
                                  {hasSettings && (
                                    <Button
                                      danger
                                      size="large"
                                      icon={<DeleteOutlined />}
                                      onClick={handleDelete}
                                      loading={loading}
                                      style={{ flex: 1, height: '44px' }}
                                    >
                                      删除
                                    </Button>
                                  )}
                                </Space>
                              </Space>
                            ) : (
                              // 桌面端：删除在左边，测试、重置和保存在右边
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '16px',
                                flexWrap: 'wrap'
                              }}>
                                {/* 左侧：删除按钮 */}
                                {hasSettings ? (
                                  <Button
                                    danger
                                    size="large"
                                    icon={<DeleteOutlined />}
                                    onClick={handleDelete}
                                    loading={loading}
                                    style={{
                                      minWidth: '100px'
                                    }}
                                  >
                                    删除配置
                                  </Button>
                                ) : (
                                  <div /> // 占位符，保持右侧按钮位置
                                )}

                                {/* 右侧：测试、重置和保存按钮组 */}
                                <Space size="middle">
                                  <Button
                                    size="large"
                                    icon={<ThunderboltOutlined />}
                                    onClick={handleTestConnection}
                                    loading={testingApi}
                                    style={{
                                      borderColor: token.colorSuccess,
                                      color: token.colorSuccess,
                                      fontWeight: 500,
                                      minWidth: '100px'
                                    }}
                                  >
                                    {testingApi ? '测试中...' : '测试'}
                                  </Button>
                                  <Button
                                    size="large"
                                    icon={<ReloadOutlined />}
                                    onClick={handleReset}
                                    style={{
                                      minWidth: '100px'
                                    }}
                                  >
                                    重置
                                  </Button>
                                  <Button
                                    type="primary"
                                    size="large"
                                    icon={<SaveOutlined />}
                                    htmlType="submit"
                                    loading={loading}
                                    style={{
                                      background: token.colorPrimary,
                                      border: 'none',
                                      minWidth: '120px',
                                      fontWeight: 500
                                    }}
                                  >
                                    保存
                                  </Button>
                                </Space>
                              </div>
                            )}
                          </Form.Item>
                        </Form>
                      </Spin>
                    </Space>
                  ),
                },
                {
                  key: 'cover',
                  label: <Space size={6}><PictureOutlined />图片模型配置</Space>,
                  children: (
                    <Spin spinning={initialLoading}>
                      <Form form={form} layout="vertical" onFinish={handleSave} autoComplete="off">

                        <Form.Item label="封面图片生成功能" name="cover_enabled" style={{ marginBottom: 16 }}>
                          <Select
                            size={isMobile ? 'middle' : 'large'}
                            onChange={() => setCoverTestResult(null)}
                            options={[
                              { value: true, label: '启用封面图片生成' },
                              { value: false, label: '停用封面图片生成' },
                            ]}
                          />
                        </Form.Item>

                        <Form.Item label="封面图片 Provider" name="cover_api_provider" rules={[{ required: true, message: '请选择封面图片 Provider' }]}>
                          <Select size={isMobile ? 'middle' : 'large'} onChange={handleCoverProviderChange}>
                            {coverApiProviders.map(provider => (
                              <Option key={provider.value} value={provider.value}>{provider.label}</Option>
                            ))}
                          </Select>
                        </Form.Item>

                        <Form.Item label="封面图片 API Key" name="cover_api_key" rules={[{ required: true, message: '请输入封面图片 API Key' }]}>
                          <Input.Password size={isMobile ? 'middle' : 'large'} placeholder="输入封面图片 API Key" autoComplete="new-password" />
                        </Form.Item>

                        <Form.Item label="封面图片 API 地址" name="cover_api_base_url" rules={[{ type: 'url', message: '请输入有效的URL' }]}>
                          <Input size={isMobile ? 'middle' : 'large'} placeholder={selectedCoverProvider === 'grok' ? 'https://api.x.ai/v1' : 'https://generativelanguage.googleapis.com/v1beta'} />
                        </Form.Item>

                        <Form.Item label="封面图片模型" name="cover_image_model" rules={[{ required: true, message: '请输入封面图片模型名称' }]}>
                          <Input
                            size={isMobile ? 'middle' : 'large'}
                            placeholder={selectedCoverProvider === 'grok'
                              ? 'grok-2-image'
                              : 'gemini-2.0-flash-exp-image-generation'}
                          />
                        </Form.Item>

                        {coverTestResult && (
                          <Alert
                            type={coverTestResult.success ? 'success' : 'error'}
                            showIcon
                            message={coverTestResult.message}
                            description={coverTestResult.success ? `Provider: ${coverTestResult.provider || '-'} / Model: ${coverTestResult.model || '-'}` : undefined}
                            style={{ marginBottom: 16 }}
                          />
                        )}

                        <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
                          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Space wrap>
                              <Button
                                icon={<ThunderboltOutlined />}
                                onClick={handleCoverTestConnection}
                                loading={testingCoverApi}
                                style={{ borderColor: token.colorSuccess, color: token.colorSuccess, fontWeight: 500 }}
                              >
                                {testingCoverApi ? '测试中...' : '测试封面接口'}
                              </Button>
                              <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
                            </Space>
                            <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={loading}>保存封面配置</Button>
                          </Space>
                        </Form.Item>
                      </Form>
                    </Spin>
                  ),
                },
                {
                  key: 'presets',
                  label: <Space size={6}><CopyOutlined />配置预设</Space>,
                  children: renderPresetsList(),
                },
              ]}
            />
          </Card>
        </div>

        {/* 预设编辑对话框（仅支持编辑已有预设，不支持新建） */}
        <Modal
          title="编辑预设"
          open={isPresetModalVisible}
          onOk={handlePresetSave}
          onCancel={handlePresetCancel}
          width={isMobile ? '95%' : 640}
          centered
          okText="保存"
          cancelText="取消"
          styles={{
            body: {
              padding: isMobile ? '16px' : '20px 24px'
            }
          }}
        >
          <Form
            form={presetForm}
            layout="vertical"
            size={isMobile ? 'middle' : 'large'}
          >
            {/* 基本信息 */}
            <Form.Item
              name="name"
              label="预设名称"
              rules={[
                { required: true, message: '请输入预设名称' },
                { max: 50, message: '名称不能超过50个字符' },
              ]}
              style={{ marginBottom: 16 }}
            >
              <Input placeholder="例如：工作账号-GPT4" />
            </Form.Item>

            <Form.Item
              name="description"
              label="预设描述"
              rules={[{ max: 200, message: '描述不能超过200个字符' }]}
              style={{ marginBottom: 16 }}
            >
              <Input placeholder="例如：用于日常写作任务（可选）" />
            </Form.Item>

            {/* 模型配置：与主「文本模型配置」同源，直接使用系统 NewAPI 模型列表（含价格） */}
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="llm_model"
                  label={
                    <Space size={4}>
                      <span>模型</span>
                      <InfoCircleOutlined
                        title="预设仅使用系统提供的 API，模型列表与主「文本模型配置」一致，含价格"
                        style={{ color: token.colorTextSecondary, fontSize: '12px' }}
                      />
                    </Space>
                  }
                  rules={[{ required: true, message: '请选择模型' }]}
                  style={{ marginBottom: 16 }}
                >
                  <Select
                    size={isMobile ? 'middle' : 'large'}
                    showSearch
                    placeholder="选择模型"
                    optionFilterProp="label"
                    loading={fetchingNewApiModels}
                    disabled={!newApiSubscribed}
                    options={newApiModels.map((m) => ({
                      value: m.id,
                      label: m.id === presetForm.getFieldValue('llm_model') ? `${m.id}（当前）` : m.id,
                      pricing: m.pricing,
                    }))}
                    optionRender={(option: any) => (
                      <div>
                        <div style={{ fontWeight: 500 }}>{option.data.value}</div>
                        {option.data.pricing && (
                          <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                            价格：输入 ${option.data.pricing.input}/百万tokens · 输出 ${option.data.pricing.output}/百万tokens
                          </div>
                        )}
                      </div>
                    )}
                    notFoundContent={
                      fetchingNewApiModels ? <div style={{ padding: 8, textAlign: 'center' }}><Spin size="small" /> 加载中...</div> : null
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item
                  name="temperature"
                  label="温度"
                  rules={[{ required: true, message: '必填' }]}
                  style={{ marginBottom: 16 }}
                >
                  <InputNumber
                    min={0}
                    max={2}
                    step={0.1}
                    style={{ width: '100%' }}
                    placeholder="0.7"
                  />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item
                  name="max_tokens"
                  label="最大Tokens"
                  rules={[{ required: true, message: '必填' }]}
                  style={{ marginBottom: 16 }}
                >
                  <InputNumber
                    min={1}
                    max={100000}
                    style={{ width: '100%' }}
                    placeholder="2000"
                  />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="system_prompt"
              label="系统提示词"
              style={{ marginBottom: 0 }}
            >
              <TextArea
                rows={isMobile ? 2 : 3}
                placeholder="例如：你是一个专业的小说创作助手...（可选）"
                maxLength={10000}
                showCount
              />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </>
  );
}