import { Button } from 'antd';
import type { ButtonProps } from 'antd';
import { Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  const goHome: ButtonProps['onClick'] = () => {
    navigate('/');
  };

  const goBack: ButtonProps['onClick'] = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="您访问的页面不存在或已被移动"
      extra={[
        <Button key="home" type="primary" onClick={goHome}>
          返回书架
        </Button>,
        <Button key="back" onClick={goBack}>
          返回上一页
        </Button>,
      ]}
    />
  );
}
