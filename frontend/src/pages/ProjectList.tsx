import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Modal, message, Spin, Space, Tag, Typography, Upload, Checkbox, Tooltip, Grid, theme } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { projectApi } from '../services/api';
import { useStore } from '../store';
import { useProjectSync } from '../store/hooks';
import type { ReactNode } from 'react';
import type { Project } from '../types';
import BookshelfPage from './BookshelfPage';

const { Text } = Typography;
const { useBreakpoint } = Grid;

/**
 * 格式化字数显示
 * @param count 字数
 * @returns 格式化后的字符串，如 "1.2K", "3.5W", "1.2M"
 */
const formatWordCount = (count: number): string => {
  if (count < 1000) {
    return count.toString();
  } else if (count < 10000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  } else if (count < 1000000) {
    return (count / 10000).toFixed(1).replace(/\.0$/, '') + 'W';
  } else {
    return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
};

/**
 * 书架页（项目列表）。壳（侧边栏 / 顶栏 / 底部版本条）由 RootLayout 提供，
 * 本组件只负责书架业务与导入/导出弹窗。
 */
export default function ProjectList() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const { projects, loading } = useStore();
  const [modal, contextHolder] = Modal.useModal();
  const [showApiTip, setShowApiTip] = useState(true);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [exportOptions, setExportOptions] = useState({
    includeWritingStyles: true,
    includeGenerationHistory: false,
    includeCareers: true,
    includeMemories: false,
    includePlotAnalysis: false,
  });
  const { refreshProjects, deleteProject } = useProjectSync();
  const { token } = theme.useToken();

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refreshProjects();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = (id: string) => {
    modal.confirm({
      title: '确认删除',
      content: '删除项目将同时删除所有相关数据，此操作不可恢复。确定要删除吗？',
      okText: '确定',
      cancelText: '取消',
      okType: 'danger',
      centered: true,
      ...(isMobile && {
        style: { top: 'auto' },
      }),
      onOk: async () => {
        try {
          await deleteProject(id);
          message.success('项目删除成功');
        } catch {
          message.error('删除项目失败');
        }
      },
    });
  };

  const handleEnterProject = (project: Project) => {
    if (project.wizard_status === 'incomplete') {
      navigate(`/wizard?project_id=${project.id}`);
    } else {
      navigate(`/project/${project.id}`);
    }
  };

  const handleGenerateCover = async (project: Project, overwrite: boolean = true) => {
    try {
      message.loading({ content: `正在为《${project.title}》生成封面...`, key: `cover-${project.id}` });
      await projectApi.generateCover(project.id, overwrite);
      message.success({ content: `《${project.title}》封面生成成功`, key: `cover-${project.id}` });
      await refreshProjects();
    } catch (error) {
      console.error('生成封面失败:', error);
      message.error({ content: `《${project.title}》封面生成失败`, key: `cover-${project.id}` });
    }
  };

  const handleDownloadCover = async (project: Project) => {
    try {
      await projectApi.downloadCover(project.id, `${project.title}-cover.png`);
      message.success(`《${project.title}》封面已开始下载`);
    } catch (error) {
      console.error('下载封面失败:', error);
      message.error('下载封面失败');
    }
  };

  const getStatusTag = (status: string) => {
    const statusConfig: Record<string, { color: string; text: string; icon: ReactNode }> = {
      planning: { color: 'blue', text: '规划', icon: null },
      writing: { color: 'green', text: '创作', icon: null },
      revising: { color: 'orange', text: '修订', icon: null },
      completed: { color: 'purple', text: '已完结', icon: null },
    };
    const config = statusConfig[status] || statusConfig.planning;
    return (
      <Tag color={config.color} style={{ margin: 0, borderRadius: 4, flexShrink: 0 }}>
        {config.text}
      </Tag>
    );
  };

  const getDisplayStatus = (status: string, progress: number): string => {
    if (progress >= 100) {
      return 'completed';
    }
    return status;
  };

  const getProgress = (current: number, target: number) => {
    if (!target) return 0;
    return Math.min(Math.round((current / target) * 100), 100);
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 80) return token.colorSuccess;
    if (progress >= 50) return token.colorPrimary;
    if (progress >= 20) return token.colorWarning;
    return token.colorError;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setValidationResult(null);
    try {
      setValidating(true);
      const result = await projectApi.validateImportFile(file);
      setValidationResult(result);
      if (!result.valid) {
        message.error('文件验证失败');
      }
    } catch (error) {
      console.error('验证失败:', error);
      message.error('文件验证失败');
    } finally {
      setValidating(false);
    }
    return false;
  };

  const handleImport = async () => {
    if (!selectedFile || !validationResult?.valid) {
      message.warning('请选择有效的导入文件');
      return;
    }
    try {
      setImporting(true);
      const result = await projectApi.importProject(selectedFile);
      if (result.success) {
        message.success(`项目导入成功！${result.message}`);
        setImportModalVisible(false);
        setSelectedFile(null);
        setValidationResult(null);
        await refreshProjects();
        if (result.project_id) {
          navigate(`/project/${result.project_id}`);
        }
      } else {
        message.error(result.message || '导入失败');
      }
    } catch (error) {
      console.error('导入失败:', error);
      message.error('导入失败，请重试');
    } finally {
      setImporting(false);
    }
  };

  const handleCloseImportModal = () => {
    setImportModalVisible(false);
    setSelectedFile(null);
    setValidationResult(null);
  };

  const handleOpenExportModal = () => {
    setExportModalVisible(true);
    setSelectedProjectIds([]);
  };

  const exportableProjects = projects;

  const handleCloseExportModal = () => {
    setExportModalVisible(false);
    setSelectedProjectIds([]);
  };

  const handleToggleProject = (projectId: string) => {
    setSelectedProjectIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]
    );
  };

  const handleToggleAll = () => {
    if (selectedProjectIds.length === exportableProjects.length) {
      setSelectedProjectIds([]);
    } else {
      setSelectedProjectIds(exportableProjects.map((p) => p.id));
    }
  };

  const handleExport = async () => {
    if (selectedProjectIds.length === 0) {
      message.warning('请至少选择一个项目');
      return;
    }
    try {
      setExporting(true);
      if (selectedProjectIds.length === 1) {
        const projectId = selectedProjectIds[0];
        const project = projects.find((p) => p.id === projectId);
        await projectApi.exportProjectData(projectId, {
          include_generation_history: exportOptions.includeGenerationHistory,
          include_writing_styles: exportOptions.includeWritingStyles,
          include_careers: exportOptions.includeCareers,
          include_memories: exportOptions.includeMemories,
          include_plot_analysis: exportOptions.includePlotAnalysis,
        });
        message.success(`项目 "${project?.title}" 导出成功`);
      } else {
        let successCount = 0;
        let failCount = 0;
        for (const projectId of selectedProjectIds) {
          try {
            await projectApi.exportProjectData(projectId, {
              include_generation_history: exportOptions.includeGenerationHistory,
              include_writing_styles: exportOptions.includeWritingStyles,
              include_careers: exportOptions.includeCareers,
              include_memories: exportOptions.includeMemories,
              include_plot_analysis: exportOptions.includePlotAnalysis,
            });
            successCount++;
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`导出项目 ${projectId} 失败:`, error);
            failCount++;
          }
        }
        if (failCount === 0) {
          message.success(`成功导出 ${successCount} 个项目`);
        } else {
          message.warning(`导出完成：成功 ${successCount} 个，失败 ${failCount} 个`);
        }
      }
      handleCloseExportModal();
    } catch (error) {
      console.error('导出失败:', error);
      message.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div ref={scrollContainerRef}>
      {contextHolder}

      <BookshelfPage
        isMobile={isMobile}
        loading={loading}
        projects={projects}
        showApiTip={showApiTip}
        setShowApiTip={setShowApiTip}
        exportableProjectsCount={exportableProjects.length}
        onOpenImportModal={() => setImportModalVisible(true)}
        onOpenExportModal={handleOpenExportModal}
        onGoSettings={() => navigate('/settings')}
        onStartWizard={() => navigate('/wizard')}
        onOpenInspiration={() => navigate('/inspiration')}
        onEnterProject={handleEnterProject}
        onDeleteProject={handleDelete}
        onGenerateCover={handleGenerateCover}
        onDownloadCover={handleDownloadCover}
        formatWordCount={formatWordCount}
        getProgress={getProgress}
        getProgressColor={getProgressColor}
        getDisplayStatus={getDisplayStatus}
        getStatusTag={getStatusTag}
        formatDate={formatDate}
      />

      {/* 导入项目对话框 */}
      <Modal
        title="导入项目"
        open={importModalVisible}
        onOk={handleImport}
        onCancel={handleCloseImportModal}
        confirmLoading={importing}
        okText="导入"
        cancelText="取消"
        width={isMobile ? '90%' : 500}
        centered
        okButtonProps={{ disabled: !validationResult?.valid }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <p style={{ marginBottom: '12px', color: token.colorTextSecondary }}>
              选择之前导出的 JSON 格式项目文件
            </p>
            <Upload
              accept=".json"
              beforeUpload={handleFileSelect}
              maxCount={1}
              onRemove={() => {
                setSelectedFile(null);
                setValidationResult(null);
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              fileList={selectedFile ? [{ uid: '-1', name: selectedFile.name, status: 'done' }] as any : []}
            >
              <Button icon={<UploadOutlined />} block>
                选择文件
              </Button>
            </Upload>
          </div>

          {validating && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <Spin tip="验证文件中..." />
            </div>
          )}

          {validationResult && (
            <Card size="small" style={{ background: validationResult.valid ? token.colorSuccessBg : token.colorErrorBg }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div>
                  <Text strong style={{ color: validationResult.valid ? token.colorSuccess : token.colorError }}>
                    {validationResult.valid ? '✓ 文件验证通过' : '✗ 文件验证失败'}
                  </Text>
                </div>
                {validationResult.project_name && (
                  <div>
                    <Text type="secondary">项目名称：</Text>
                    <Text strong>{validationResult.project_name}</Text>
                  </div>
                )}
                {validationResult.statistics && (
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                      数据统计：
                    </Text>
                    <Space size={[6, 6]} wrap>
                      {validationResult.statistics.chapters > 0 && (
                        <Tag color="blue">章节: {validationResult.statistics.chapters}</Tag>
                      )}
                      {validationResult.statistics.characters > 0 && (
                        <Tag color="green">角色: {validationResult.statistics.characters}</Tag>
                      )}
                      {validationResult.statistics.outlines > 0 && (
                        <Tag color="cyan">大纲: {validationResult.statistics.outlines}</Tag>
                      )}
                      {validationResult.statistics.relationships > 0 && (
                        <Tag color="purple">关系: {validationResult.statistics.relationships}</Tag>
                      )}
                      {validationResult.statistics.organizations > 0 && (
                        <Tag color="orange">组织: {validationResult.statistics.organizations}</Tag>
                      )}
                      {validationResult.statistics.careers > 0 && (
                        <Tag color="magenta">职业: {validationResult.statistics.careers}</Tag>
                      )}
                      {validationResult.statistics.character_careers > 0 && (
                        <Tag color="geekblue">职业关联: {validationResult.statistics.character_careers}</Tag>
                      )}
                      {validationResult.statistics.writing_styles > 0 && (
                        <Tag color="lime">写作风格: {validationResult.statistics.writing_styles}</Tag>
                      )}
                      {validationResult.statistics.story_memories > 0 && (
                        <Tag color="gold">故事记忆: {validationResult.statistics.story_memories}</Tag>
                      )}
                      {validationResult.statistics.plot_analysis > 0 && (
                        <Tag color="volcano">剧情分析: {validationResult.statistics.plot_analysis}</Tag>
                      )}
                      {validationResult.statistics.generation_history > 0 && (
                        <Tag>生成历史: {validationResult.statistics.generation_history}</Tag>
                      )}
                      {validationResult.statistics.has_default_style && (
                        <Tag color="success">含默认风格</Tag>
                      )}
                    </Space>
                  </div>
                )}
                {validationResult.warnings?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Text type="warning" strong style={{ fontSize: 12 }}>
                      提示：
                    </Text>
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, color: token.colorWarning, fontSize: 12 }}>
                      {validationResult.warnings.map((w: string, i: number) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {validationResult.errors?.length > 0 && (
                  <div>
                    <Text type="danger" strong>
                      错误：
                    </Text>
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, color: token.colorError, fontSize: 13 }}>
                      {validationResult.errors.map((e: string, i: number) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Space>
            </Card>
          )}
        </Space>
      </Modal>

      {/* 导出项目对话框 */}
      <Modal
        title="导出项目"
        open={exportModalVisible}
        onOk={handleExport}
        onCancel={handleCloseExportModal}
        confirmLoading={exporting}
        okText={selectedProjectIds.length > 0 ? `导出 (${selectedProjectIds.length})` : '导出'}
        cancelText="取消"
        width={isMobile ? '90%' : 700}
        centered
        okButtonProps={{ disabled: selectedProjectIds.length === 0 }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" style={{ background: token.colorFillTertiary }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Text strong>导出选项</Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}>
                <Checkbox
                  checked={exportOptions.includeWritingStyles}
                  onChange={(e) => setExportOptions((prev) => ({ ...prev, includeWritingStyles: e.target.checked }))}
                >
                  写作风格
                </Checkbox>
                <Checkbox
                  checked={exportOptions.includeCareers}
                  onChange={(e) => setExportOptions((prev) => ({ ...prev, includeCareers: e.target.checked }))}
                >
                  职业系统
                </Checkbox>
                <Tooltip title="包含生成历史记录，文件可能较大">
                  <Checkbox
                    checked={exportOptions.includeGenerationHistory}
                    onChange={(e) =>
                      setExportOptions((prev) => ({ ...prev, includeGenerationHistory: e.target.checked }))
                    }
                  >
                    生成历史
                  </Checkbox>
                </Tooltip>
                <Tooltip title="包含故事记忆数据，文件可能较大">
                  <Checkbox
                    checked={exportOptions.includeMemories}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, includeMemories: e.target.checked }))}
                  >
                    故事记忆
                  </Checkbox>
                </Tooltip>
                <Tooltip title="包含AI剧情分析数据">
                  <Checkbox
                    checked={exportOptions.includePlotAnalysis}
                    onChange={(e) => setExportOptions((prev) => ({ ...prev, includePlotAnalysis: e.target.checked }))}
                  >
                    剧情分析
                  </Checkbox>
                </Tooltip>
              </div>
            </Space>
          </Card>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text>选择项目 ({exportableProjects.length})</Text>
              <Checkbox
                checked={
                  selectedProjectIds.length === exportableProjects.length && exportableProjects.length > 0
                }
                indeterminate={selectedProjectIds.length > 0 && selectedProjectIds.length < exportableProjects.length}
                onChange={handleToggleAll}
              >
                全选
              </Checkbox>
            </div>
            <div
              style={{
                maxHeight: 300,
                overflowY: 'auto',
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 8,
                padding: 8,
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {exportableProjects.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      padding: '8px 12px',
                      background: selectedProjectIds.includes(p.id) ? token.colorPrimaryBg : token.colorBgContainer,
                      borderRadius: 6,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                    onClick={() => handleToggleProject(p.id)}
                  >
                    <Checkbox checked={selectedProjectIds.includes(p.id)} />
                    <div style={{ flex: 1 }}>
                      <div>{p.title}</div>
                      <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                        {formatWordCount(p.current_words || 0)} 字 ·{' '}
                        {getStatusTag(
                          getDisplayStatus(
                            p.status,
                            getProgress(p.current_words || 0, p.target_words || 0)
                          )
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </Space>
            </div>
          </div>
        </Space>
      </Modal>
    </div>
  );
}
