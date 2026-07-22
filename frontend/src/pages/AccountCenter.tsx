import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, List, Row, Space, Statistic, Tag, message } from 'antd';
import {
  WalletOutlined,
  ThunderboltOutlined,
  CrownOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { newApi } from '../services/api';
import './AccountCenter.css';

interface BalanceData {
  enabled: boolean;
  bound: boolean;
  total_quota: number;
  used_quota: number;
  remaining_quota: number;
  wallet_remaining_quota: number;
  subscription_remaining_quota: number;
  estimated_words: number;
}

interface StatusData {
  enabled: boolean;
  bound: boolean;
  is_subscribed: boolean;
  subscription_expired_at?: string;
  current_model: string | null;
  default_model: string;
}

interface TopupInfo {
  amount_options: number[];
  min_topup: number;
  pay_methods: Array<{ name: string; type: string; color?: string; min_topup?: string }>;
  enable_redemption: boolean;
}

interface SubscriptionPlan {
  id: number;
  title: string;
  subtitle: string;
  price_amount: number;
  currency: string;
  duration_unit: string;
  duration_value: number;
  total_amount: number;
  allow_balance_pay: boolean;
}

interface HistoryItem {
  id?: number | string;
  amount?: number;
  money?: number;
  status?: string;
  created_at?: number | string;
  trade_no?: string;
  plan_title?: string;
  type?: string;
}

// amount_options 中的数值直接作为美元额度显示
const QUOTA_PER_UNIT = 500000;

// 格式化金额（New API price_amount 直接为美元整数）
function formatPrice(price: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : '';
  return `${symbol}${price.toFixed(2)}`;
}

// 格式化订阅周期
function formatDuration(value: number, unit: string): string {
  const unitMap: Record<string, string> = {
    day: '天',
    month: '月',
    year: '年',
  };
  return `${value} ${unitMap[unit] || unit}`;
}

// 格式化 ISO 时间为本地时间字符串
function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export default function AccountCenter() {
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [topupInfo, setTopupInfo] = useState<TopupInfo | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [recharging, setRecharging] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [bal, st] = await Promise.all([
        newApi.getBalance(),
        newApi.getStatus(),
      ]);
      setBalance(bal as any);
      setStatus(st as any);

      // 并行获取充值信息、订阅套餐、历史记录
      try {
        const info = await newApi.getTopupInfo() as any;
        if (info?.success) setTopupInfo(info.data);
      } catch (e) {
        // 充值信息获取失败不阻塞主流程
      }

      try {
        const plansResp = await newApi.getSubscriptionPlans() as any;
        if (plansResp?.success && Array.isArray(plansResp.data)) {
          setPlans(plansResp.data.map((item: any) => item.plan).filter(Boolean));
        }
      } catch (e) {
        // 订阅套餐获取失败不阻塞
      }

      try {
        const hist = await newApi.listSubscriptions();
        setHistory((hist as any)?.items || []);
      } catch (e) {
        // 历史记录获取失败不阻塞
      }
    } catch (e) {
      // 错误已由 axios 拦截器处理
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 充值：调用 New API 支付接口，返回支付链接后跳转
  const handleRecharge = async (amount: number, paymentMethod: string) => {
    setRecharging(true);
    try {
      const res: any = await newApi.createRecharge(amount, paymentMethod);
      // New API waffo/stripe/creem 返回 data.checkout_url；epay 返回 data 为支付链接
      const checkoutUrl = res?.data?.checkout_url || (typeof res?.data === 'string' ? res.data : null);
      if (checkoutUrl) {
        message.success('正在跳转到支付页面...');
        window.open(checkoutUrl, '_blank');
      } else if (res?.success || res?.message === 'success') {
        message.success('充值请求已提交');
        refresh();
      } else {
        message.error(res?.message || '充值失败');
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '充值请求失败');
    } finally {
      setRecharging(false);
    }
  };

  // 订阅：用余额支付购买订阅套餐
  const handleSubscribe = async (planId: number) => {
    setRecharging(true);
    try {
      const res: any = await newApi.subscribe(planId, 'balance');
      if (res?.success) {
        message.success('订阅成功，额度已到账');
        refresh();
      } else {
        message.error(res?.message || '订阅失败');
      }
    } catch (e) {
      // 错误已处理
    } finally {
      setRecharging(false);
    }
  };

  const handleActivate = async () => {
    try {
      await newApi.activate();
      message.success('AI 服务已激活');
      refresh();
    } catch (e) {
      // 错误已处理
    }
  };

  // New API 未启用
  if (status && !status.enabled) {
    return (
      <div className="account-center">
        <Alert
          type="info"
          showIcon
          message="AI 额度中心未启用"
          description="当前部署未配置 New API 中转网关，AI 调用使用直连模式。如需启用按量计费与订阅功能，请联系管理员配置。"
        />
      </div>
    );
  }

  // 未绑定
  if (status && !status.bound) {
    return (
      <div className="account-center">
        <Card title="激活 AI 服务">
          <Alert
            type="warning"
            showIcon
            message="尚未激活 AI 服务"
            description="激活后将自动获得 $5 赠送额度，可开始使用 AI 写作。"
          />
          <div style={{ marginTop: 16 }}>
            <Button type="primary" icon={<RocketOutlined />} onClick={handleActivate} loading={loading}>
              立即激活
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="account-center">
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card loading={loading}>
            <Statistic
              title="剩余额度"
              value={balance?.remaining_quota ?? 0}
              precision={2}
              prefix={<WalletOutlined />}
              suffix="$"
            />
            <div style={{ marginTop: 8, color: '#888' }}>
              总额 ${balance?.total_quota ?? 0} · 已用 ${balance?.used_quota ?? 0}
            </div>
            <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>
              钱包 ${balance?.wallet_remaining_quota ?? 0} · 订阅 ${balance?.subscription_remaining_quota ?? 0}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card loading={loading}>
            <Statistic
              title="可生成字数"
              value={balance?.estimated_words ?? 0}
              prefix={<ThunderboltOutlined />}
              suffix="字"
            />
            <div style={{ marginTop: 8, color: '#888' }}>按平均消耗粗略估算</div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card loading={loading}>
            <Statistic
              title="订阅状态"
              value={status?.is_subscribed ? '订阅中' : '未订阅'}
              prefix={<CrownOutlined />}
            />
            <div style={{ marginTop: 8, color: '#888' }}>
              当前模型：{status?.current_model || status?.default_model}
            </div>
            {status?.is_subscribed && status?.subscription_expired_at && (
              <div style={{ marginTop: 4, color: '#888' }}>
                到期时间：{formatDateTime(status.subscription_expired_at)}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 充值：从 New API 动态获取档位 */}
      <Card
        title="充值"
        style={{ marginTop: 16 }}
        extra={<Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>}
      >
        {topupInfo ? (
          <Space wrap size="middle">
            {topupInfo.amount_options.map((amount) => (
              <Card
                key={amount}
                hoverable
                size="small"
                style={{ width: 140, textAlign: 'center' }}
                onClick={() => handleRecharge(amount, topupInfo.pay_methods[0]?.type || 'waffo_pancake')}
              >
                <div style={{ fontSize: 20, fontWeight: 600 }}>+${amount}</div>
                <div style={{ color: '#888', marginTop: 4, fontSize: 12 }}>
                  {topupInfo.pay_methods[0]?.name || '在线支付'}
                </div>
                <Button type="primary" size="small" style={{ marginTop: 8 }} loading={recharging}>
                  充值
                </Button>
              </Card>
            ))}
          </Space>
        ) : (
          <div style={{ color: '#888' }}>
            {loading ? '加载中...' : '暂无充值选项，请检查 New API 支付配置'}
          </div>
        )}
      </Card>

      {/* 订阅套餐：从 New API 动态获取 */}
      <Card title="订阅套餐" style={{ marginTop: 16 }}>
        {plans.length > 0 ? (
          <Row gutter={[16, 16]}>
            {plans.map((plan) => (
              <Col xs={24} md={12} lg={8} key={plan.id}>
                <Card hoverable>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>
                    <CrownOutlined style={{ color: '#faad14' }} /> {plan.title}
                  </div>
                  {plan.subtitle && (
                    <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>{plan.subtitle}</div>
                  )}
                  <div style={{ fontSize: 24, color: '#1677ff', margin: '8px 0' }}>
                    {formatPrice(plan.price_amount, plan.currency)}
                    <span style={{ fontSize: 14, color: '#888' }}> /{formatDuration(plan.duration_value, plan.duration_unit)}</span>
                  </div>
                  <div style={{ color: '#52c41a' }}>
                    授予 ${(plan.total_amount / QUOTA_PER_UNIT).toFixed(2)} 额度（用完即止）
                  </div>
                  <Button
                    type="primary"
                    block
                    style={{ marginTop: 12 }}
                    onClick={() => handleSubscribe(plan.id)}
                    loading={recharging}
                    disabled={!plan.allow_balance_pay}
                  >
                    {plan.allow_balance_pay ? '余额支付订阅' : '暂不支持余额支付'}
                  </Button>
                </Card>
              </Col>
            ))}
          </Row>
        ) : (
          <div style={{ color: '#888' }}>
            {loading ? '加载中...' : '暂无订阅套餐，请检查 New API 订阅配置'}
          </div>
        )}
      </Card>

      {/* 充值/订阅历史 */}
      <Card
        title={<><HistoryOutlined /> 充值/订阅记录</>}
        style={{ marginTop: 16 }}
      >
        <List
          dataSource={history}
          locale={{ emptyText: '暂无记录' }}
          renderItem={(item: any) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={item.type === 'subscription' || item.plan_title ? 'gold' : 'blue'}>
                      {item.type === 'subscription' || item.plan_title ? '订阅' : '充值'}
                    </Tag>
                    {item.status && (
                      <Tag color={item.status === 'paid' || item.status === 'completed' ? 'green' : 'default'}>
                        {item.status === 'paid' || item.status === 'completed' ? '已完成' : item.status}
                      </Tag>
                    )}
                    {item.trade_no && <span style={{ color: '#888', fontSize: 12 }}>{item.trade_no}</span>}
                  </Space>
                }
                description={
                  item.amount
                    ? `金额 $${(item.amount / QUOTA_PER_UNIT).toFixed(2)} · ${item.created_at ? new Date(typeof item.created_at === 'number' ? item.created_at * 1000 : item.created_at).toLocaleString() : ''}`
                    : item.created_at
                    ? new Date(typeof item.created_at === 'number' ? item.created_at * 1000 : item.created_at).toLocaleString()
                    : ''
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
