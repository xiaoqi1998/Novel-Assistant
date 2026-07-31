"""短故事数据模型"""
from sqlalchemy import Column, String, Text, DateTime, Integer, CheckConstraint
from sqlalchemy.sql import func
from app.database import Base
import uuid


class ShortStory(Base):
    """短故事表"""
    __tablename__ = "short_stories"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(100), nullable=False, index=True, comment="用户ID")

    # 基本信息
    title = Column(String(200), nullable=False, comment="故事标题")
    logline = Column(Text, comment="一句话梗概：主角+困境+反转+情绪落点")
    genre = Column(String(50), comment="题材标签")
    target_platform = Column(String(50), comment="目标平台：知乎盐言/番茄短篇/七猫短篇/黑岩/点众")
    target_words = Column(Integer, default=12000, comment="目标字数，短篇通常8000-20000")
    current_words = Column(Integer, default=0, comment="当前字数")

    # 情绪目标
    emotion_goal = Column(String(50), comment="情绪目标：意难平/反转震撼/爽感释放/治愈温暖/细思极恐/共鸣感动")
    emotion_goal_desc = Column(Text, comment="情绪目标描述")

    # 核心反转
    twist_type = Column(String(50), comment="反转类型：身份反转/视角反转/动机反转/时间线反转")
    twist_content = Column(Text, comment="反转内容描述")
    twist_clues = Column(Text, comment="铺垫线索JSON数组")

    # 情绪曲线 JSON
    emotion_curve = Column(Text, comment="情绪曲线JSON：[{stage, emotion, intensity}]")

    # 人设速写 JSON
    characters = Column(Text, comment="人设速写JSON：[{name, role, desc, relationship}]")

    # 正文与分段
    content = Column(Text, comment="完整正文")
    segments = Column(Text, comment="分段进度JSON：[{stage, target_ratio, target_words, actual_words, status}]")

    # 精修
    polish_notes = Column(Text, comment="精修笔记")
    polish_checklist = Column(Text, comment="精修清单JSON")

    # 状态与封面
    status = Column(String(20), default="planning", comment="状态: planning/writing/generating/generated/polishing/completed")
    cover_image_url = Column(String(1000), comment="封面图片访问地址")
    cover_prompt = Column(Text, comment="封面生成提示词")
    cover_status = Column(String(20), default="none", comment="封面状态: none/generating/ready/failed")

    # AI评分（JSON字符串，含total_score/level/dimensions/overall_evaluation等）
    score_data = Column(Text, comment="AI评分结果JSON")
    scored_at = Column(DateTime, comment="最近评分时间")

    # 版本历史（重生成确认时备份原文，JSON数组: [{content, title, saved_at}]）
    revision_history = Column(Text, comment="版本历史JSON数组: [{content, title, saved_at}]")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    __table_args__ = (
        CheckConstraint(
            "status IN ('planning', 'writing', 'generating', 'generated', 'polishing', 'completed')",
            name='check_short_story_status'
        ),
        CheckConstraint(
            "cover_status IN ('none', 'generating', 'ready', 'failed')",
            name='check_short_story_cover_status'
        ),
    )

    def __repr__(self):
        return f"<ShortStory(id={self.id}, title={self.title})>"
