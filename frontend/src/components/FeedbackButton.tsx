import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { FloatButton, Modal, Form, Input, message, Tooltip, theme } from 'antd';
import { CommentOutlined } from '@ant-design/icons';
import { feedbackApi } from '../services/api';
import { useStore } from '../store';

const { TextArea } = Input;

/**
 * 全局浮动意见反馈按钮（左下角小按钮）
 * 登录用户可见，点击弹出反馈表单，提交到后端供管理员处理
 */
export default function FeedbackButton() {
  const { token } = theme.useToken();
  const location = useLocation();
  const { currentUser } = useStore();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  // 未登录（如登录页）不显示
  if (!currentUser) return null;

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await feedbackApi.submit({
        content: values.content,
        contact: values.contact || undefined,
        page: location.pathname || undefined,
      });
      message.success('感谢您的反馈，我们会认真阅读每一条建议！');
      setOpen(false);
      form.resetFields();
    } catch (error: unknown) {
      // 表单校验失败不提示（antd 已标红）
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      message.error('反馈提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Tooltip title="意见反馈" placement="right">
        <FloatButton
          icon={<CommentOutlined />}
          onClick={() => setOpen(true)}
          style={{ left: 24, right: 'auto', bottom: 96 }}
          aria-label="意见反馈"
        />
      </Tooltip>

      <Modal
        title="意见反馈"
        open={open}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        onOk={handleSubmit}
        okText="提交反馈"
        cancelText="取消"
        confirmLoading={submitting}
        width={480}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="content"
            label="建议或问题"
            rules={[
              { required: true, message: '请输入反馈内容' },
              { max: 2000, message: '反馈内容不能超过2000字' },
            ]}
          >
            <TextArea
              rows={5}
              placeholder="说说您的建议、遇到的问题、希望新增的功能……"
              showCount
              maxLength={2000}
            />
          </Form.Item>
          <Form.Item
            name="contact"
            label="联系方式（可选）"
            rules={[{ max: 200, message: '联系方式不能超过200字' }]}
          >
            <Input placeholder="方便我们回复您，如 QQ / 微信 / 邮箱" />
          </Form.Item>
          <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
            提交后可在「意见反馈」由管理员查看处理进度（采纳 / 解决状态）。
          </div>
        </Form>
      </Modal>
    </>
  );
}
