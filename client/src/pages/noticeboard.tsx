import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { 
  Heart, 
  MessageCircle, 
  Send, 
  Image as ImageIcon, 
  Video,
  Pin, 
  Trash2, 
  MoreVertical,
  X,
  Loader2,
  PlusCircle,
  Megaphone
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDistanceToNow } from "date-fns";
import welcomePostImage from "@assets/generated_images/cute_robot_holding_deal_or_no_deal_clapperboard.png";

interface Post {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  imageUrl: string | null;
  videoUrl: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  commentCount: number;
  likedByCurrentUser: boolean;
}

interface Comment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

// Helper to get/set display name from localStorage
const DISPLAY_NAME_KEY = "noticeboard_display_name";
const getStoredDisplayName = () => localStorage.getItem(DISPLAY_NAME_KEY) || "";
const setStoredDisplayName = (name: string) => localStorage.setItem(DISPLAY_NAME_KEY, name);

// Helper to get/generate unique session ID for likes tracking
// Uses sessionStorage so each browser window/tab gets a fresh session
// This allows multiple people on the same shared computer to each like posts
const SESSION_ID_KEY = "noticeboard_session_id";
const getSessionId = (): string => {
  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  }
  return sessionId;
};


function PostCard({ post, onRefresh, displayName, sessionId }: { post: Post; onRefresh: () => void; displayName: string; sessionId: string }) {
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [commentName, setCommentName] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: comments = [], refetch: refetchComments } = useQuery<Comment[]>({
    queryKey: ["/api/noticeboard/posts", post.id, "comments"],
    enabled: showComments,
  });

  const likeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/noticeboard/posts/${post.id}/like`, { browserId: sessionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/noticeboard/posts"] });
    },
  });

  const pinMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/noticeboard/posts/${post.id}/pin`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/noticeboard/posts"] });
      toast({
        title: post.isPinned ? "Post unpinned" : "Post pinned",
        description: post.isPinned ? "Post removed from top" : "Post will appear at the top",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/noticeboard/posts/${post.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/noticeboard/posts"] });
      toast({ title: "Post deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete post",
        variant: "destructive",
      });
    },
  });

  const commentMutation = useMutation({
    mutationFn: (data: { content: string; authorName: string }) =>
      apiRequest("POST", `/api/noticeboard/posts/${post.id}/comments`, data),
    onSuccess: () => {
      setNewComment("");
      setCommentName(""); // Clear name after posting
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ["/api/noticeboard/posts"] });
    },
  });

  const handleSubmitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (newComment.trim() && commentName.trim()) {
      commentMutation.mutate({ content: newComment.trim(), authorName: commentName.trim() });
    }
  };

  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  return (
    <Card className={post.isPinned ? "border-primary/50 bg-primary/5" : ""}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-primary">
              {getInitials(post.authorName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-medium" data-testid={`text-author-${post.id}`}>
                {post.authorName}
              </span>
              {post.isPinned && (
                <Badge variant="secondary" className="text-xs">
                  <Pin className="h-3 w-3 mr-1" />
                  Pinned
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid={`button-post-menu-${post.id}`}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => pinMutation.mutate()}>
              <Pin className="h-4 w-4 mr-2" />
              {post.isPinned ? "Unpin" : "Pin to top"}
            </DropdownMenuItem>
            <DropdownMenuItem 
              className="text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <p className="whitespace-pre-wrap" data-testid={`text-content-${post.id}`}>
          {post.content}
        </p>
        
        {post.imageUrl && (
          <div className="relative rounded-lg overflow-hidden">
            <img
              src={post.imageUrl}
              alt="Post attachment"
              className="w-full max-h-96 object-cover rounded-lg"
              data-testid={`img-post-${post.id}`}
            />
          </div>
        )}
        
        {post.videoUrl && (
          <div className="relative rounded-lg overflow-hidden">
            <video
              src={post.videoUrl}
              controls
              className="w-full max-h-96 rounded-lg"
              data-testid={`video-post-${post.id}`}
            />
          </div>
        )}
      </CardContent>
      
      <CardFooter className="flex flex-col gap-2 items-stretch">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className={`gap-2 ${post.likedByCurrentUser ? "text-red-500" : ""}`}
            onClick={() => likeMutation.mutate()}
            disabled={likeMutation.isPending}
            data-testid={`button-like-${post.id}`}
          >
            <Heart
              className={`h-4 w-4 ${post.likedByCurrentUser ? "fill-current" : ""}`}
            />
            <span>{post.likeCount}</span>
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => setShowComments(!showComments)}
            data-testid={`button-comments-${post.id}`}
          >
            <MessageCircle className="h-4 w-4" />
            <span>{post.commentCount}</span>
          </Button>
        </div>
        
        {showComments && (
          <div className="w-full space-y-3 pt-2">
            <Separator />
            
            {comments.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-2 items-start">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs bg-muted">
                        {getInitials(comment.authorName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 bg-muted rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{comment.authorName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm">{comment.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <form onSubmit={handleSubmitComment} className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Your name"
                  value={commentName}
                  onChange={(e) => setCommentName(e.target.value)}
                  className="w-32"
                  data-testid={`input-comment-name-${post.id}`}
                />
                <Input
                  placeholder="Write a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="flex-1"
                  data-testid={`input-comment-${post.id}`}
                />
                <Button 
                  type="submit" 
                  size="icon"
                  disabled={!newComment.trim() || !commentName.trim() || commentMutation.isPending}
                  data-testid={`button-submit-comment-${post.id}`}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </div>
        )}
      </CardFooter>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Post</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this post? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CreatePostForm({ onSuccess, displayName, onDisplayNameChange, onCancel }: { 
  onSuccess: () => void; 
  displayName: string; 
  onDisplayNameChange: (name: string) => void;
  onCancel?: () => void;
}) {
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (data: { content: string; imageUrl?: string; videoUrl?: string; authorName?: string }) =>
      apiRequest("POST", "/api/noticeboard/posts", data),
    onSuccess: () => {
      setContent("");
      setImageFile(null);
      setImagePreview(null);
      setVideoFile(null);
      setVideoPreview(null);
      onSuccess();
      toast({ title: "Post created!" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create post",
        variant: "destructive",
      });
    },
  });

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Image must be less than 10MB",
          variant: "destructive",
        });
        return;
      }
      setImageFile(file);
      setVideoFile(null);
      setVideoPreview(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 100 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Video must be less than 100MB",
          variant: "destructive",
        });
        return;
      }
      setVideoFile(file);
      setImageFile(null);
      setImagePreview(null);
      const url = URL.createObjectURL(file);
      setVideoPreview(url);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    let imageUrl: string | undefined;
    let videoUrl: string | undefined;

    setIsUploading(true);

    if (imageFile) {
      try {
        const formData = new FormData();
        formData.append("image", imageFile);
        const response = await fetch("/api/noticeboard/upload-image", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!response.ok) throw new Error("Failed to upload image");
        const data = await response.json();
        imageUrl = data.imageUrl;
      } catch (error) {
        toast({
          title: "Upload failed",
          description: "Could not upload image",
          variant: "destructive",
        });
        setIsUploading(false);
        return;
      }
    }

    if (videoFile) {
      try {
        const formData = new FormData();
        formData.append("video", videoFile);
        const response = await fetch("/api/noticeboard/upload-video", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!response.ok) throw new Error("Failed to upload video");
        const data = await response.json();
        videoUrl = data.videoUrl;
      } catch (error) {
        toast({
          title: "Upload failed",
          description: "Could not upload video",
          variant: "destructive",
        });
        setIsUploading(false);
        return;
      }
    }

    setIsUploading(false);

    createMutation.mutate({ 
      content: content.trim(), 
      imageUrl,
      videoUrl,
      authorName: displayName || undefined 
    });
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const clearVideo = () => {
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }
    setVideoFile(null);
    setVideoPreview(null);
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">From:</label>
            <Input
              placeholder="Your name (optional)"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              className="max-w-[200px]"
              data-testid="input-display-name"
            />
          </div>
          <Textarea
            placeholder="Share an update with the crew..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[100px] resize-none"
            data-testid="input-new-post"
          />
          
          {imagePreview && (
            <div className="relative inline-block">
              <img
                src={imagePreview}
                alt="Preview"
                className="max-h-40 rounded-lg"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={clearImage}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {videoPreview && (
            <div className="relative inline-block">
              <video
                src={videoPreview}
                className="max-h-40 rounded-lg"
                controls
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={clearVideo}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                id="image-upload"
                onChange={handleImageSelect}
              />
              <input
                type="file"
                accept="video/*"
                className="hidden"
                id="video-upload"
                onChange={handleVideoSelect}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => document.getElementById("image-upload")?.click()}
                data-testid="button-add-image"
              >
                <ImageIcon className="h-4 w-4 mr-2" />
                Add Photo
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => document.getElementById("video-upload")?.click()}
                data-testid="button-add-video"
              >
                <Video className="h-4 w-4 mr-2" />
                Add Video
              </Button>
            </div>
            
            <div className="flex items-center gap-2">
              {onCancel && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onCancel}
                  data-testid="button-cancel-post"
                >
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                disabled={!content.trim() || createMutation.isPending || isUploading}
                data-testid="button-submit-post"
              >
                {(createMutation.isPending || isUploading) && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Post
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function NoticeboardPage() {
  const [displayName, setDisplayName] = useState(() => getStoredDisplayName());
  const [sessionId] = useState(() => getSessionId());
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: posts = [], isLoading, refetch } = useQuery<Post[]>({
    queryKey: ["/api/noticeboard/posts", { sessionId }],
    queryFn: async () => {
      const response = await fetch(`/api/noticeboard/posts?browserId=${sessionId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch posts');
      return response.json();
    },
  });

  const handleDisplayNameChange = (name: string) => {
    setDisplayName(name);
    setStoredDisplayName(name);
  };

  const handlePostSuccess = () => {
    refetch();
    setShowCreateForm(false);
  };

  return (
    <div className="container max-w-2xl mx-auto py-6 px-4">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            Crew Noticeboard
          </h1>
          <p className="text-muted-foreground">
            Share updates, photos, and announcements with the team
          </p>
        </div>
        {!showCreateForm && (
          <Button 
            onClick={() => setShowCreateForm(true)}
            data-testid="button-new-post"
          >
            <PlusCircle className="h-4 w-4 mr-2" />
            New Post
          </Button>
        )}
      </div>

      {/* Embedded welcome notice */}
      <Alert className="mb-6 border-muted bg-muted/20">
        <Megaphone className="h-4 w-4 text-muted-foreground/70" />
        <AlertTitle className="text-muted-foreground font-semibold">Welcome to the Crew Noticeboard</AlertTitle>
        <AlertDescription className="text-muted-foreground/80">
          Post updates, share photos, and keep the team in the loop. Your display name is saved locally so you can post without logging in.
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        {showCreateForm && (
          <CreatePostForm 
            onSuccess={handlePostSuccess} 
            displayName={displayName}
            onDisplayNameChange={handleDisplayNameChange}
            onCancel={() => setShowCreateForm(false)}
          />
        )}
        
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : posts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No posts yet. Be the first to share something!</p>
            </CardContent>
          </Card>
        ) : (
          posts.map((post) => (
            <PostCard key={post.id} post={post} onRefresh={() => refetch()} displayName={displayName} sessionId={sessionId} />
          ))
        )}
        
        {/* Embedded AI Agent welcome post - always appears at the bottom */}
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-2">
            <Avatar className="h-10 w-10 border border-primary/20 shadow-sm">
              <AvatarFallback className="bg-primary/10 text-primary font-bold">AI</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-semibold text-primary/80">AI Assistant</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Ready for Action</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-white/50 dark:bg-black/20 p-3 rounded-md border border-primary/10 text-sm leading-relaxed text-muted-foreground">
              Hey everyone! Welcome to the new crew noticeboard.
              {"\n\n"}
              This is the place to share updates, post behind-the-scenes photos, and keep the whole team in the loop. Whether it's a scheduling change, a shoutout to a colleague, or just something fun from set - drop it here!
            </div>
            <div className="relative rounded-lg overflow-hidden border border-primary/20 shadow-md">
              <img
                src={welcomePostImage}
                alt="Cute robot holding clapperboard"
                className="w-full max-h-96 object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
