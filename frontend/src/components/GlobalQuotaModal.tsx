import { useEffect, useState } from 'react';
import { Modal, Button, Typography } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Paragraph } = Typography;

/**
 * 全局额度不足 Modal
 *
 * 监听 window 上的 'quota:exhausted' 事件（由 axios 拦截器在 HTTP 402 时派发，
 * 以及 SSE 解析层在 event: error + code=quota_exhausted 时派发），
 * 弹出充值引导 Modal，跳转个人中心。
 *
 * 同时监听 'subscription:required' 事件（切换模型时非订阅用户）。
 */
export default function GlobalQuotaModal() {
  const navigate = useNavigate();
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [quotaMsg, setQuotaMsg] = useState('您的 AI 写作额度已用完，请前往个人中心充值。');
  const [subOpen, setSubOpen] = useState(false);
  const [subMsg, setSubMsg] = useState('切换模型需要订阅');

  useEffect(() => {
    const onQuota = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setQuotaMsg(detail?.message || '您的 AI 写作额度已用完，请前往个人中心充值。');
      setQuotaOpen(true);
    };
    const onSub = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setSubMsg(detail?.message || '切换模型需要订阅');
      setSubOpen(true);
    };
    window.addEventListener('quota:exhausted', onQuota as EventListener);
    window.addEventListener('subscription:required', onSub as EventListener);
    return () => {
      window.removeEventListener('quota:exhausted', onQuota as EventListener);
      window.removeEventListener('subscription:required', onSub as EventListener);
    };
  }, []);

  const goAccount = () => {
    setQuotaOpen(false);
    setSubOpen(false);
    navigate('/account');
  };

  return (
    <>
      <Modal
        open={quotaOpen}
        onCancel={() => setQuotaOpen(false)}
        centered
        title={
          <span>
            <ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 8 }} />
            额度不足
          </span>
        }
        footer={[
          <Button key="later" onClick={() => setQuotaOpen(false)}>稍后充值</Button>,
          <Button key="go" type="primary" onClick={goAccount}>前往充值</Button>,
        ]}
      >
        <Paragraph style={{ marginBottom: 0 }}>{quotaMsg}</Paragraph>
      </Modal>

      <Modal
        open={subOpen}
        onCancel={() => setSubOpen(false)}
        centered
        title={
          <span>
            <ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 8 }} />
            需要订阅
          </span>
        }
        footer={[
          <Button key="later" onClick={() => setSubOpen(false)}>取消</Button>,
          <Button key="go" type="primary" onClick={goAccount}>前往订阅</Button>,
        ]}
      >
        <Paragraph style={{ marginBottom: 0 }}>{subMsg}</Paragraph>
      </Modal>
    </>
  );
}
