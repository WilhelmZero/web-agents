import React from 'react';
import ReactDOM from 'react-dom/client';
import { XProvider } from '@ant-design/x';
import zhCNX from '@ant-design/x/locale/zh_CN';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <XProvider
      locale={{ ...zhCN, ...zhCNX }}
      theme={{
        token: {
          colorPrimary: '#7c5cff',
          borderRadius: 12,
          fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
      <App />
    </XProvider>
  </React.StrictMode>,
);
