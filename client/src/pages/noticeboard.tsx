import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
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
  Pin, 
  Trash2, 
  MoreVertical,
  X,
  Loader2,
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

interface Post {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  imageUrl: string | null;
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

// Helper to get/generate unique browser ID for likes tracking
const BROWSER_ID_KEY = "noticeboard_browser_id";
const getBrowserId = (): string => {
  let browserId = localStorage.getItem(BROWSER_ID_KEY);
  if (!browserId) {
    browserId = crypto.randomUUID();
    localStorage.setItem(BROWSER_ID_KEY, browserId);
  }
  return browserId;
};

function PostCard({ post, onRefresh, displayName, browserId }: { post: Post; onRefresh: () => void; displayName: string; browserId: string }) {
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: comments = [], refetch: refetchComments } = useQuery<Comment[]>({
    queryKey: ["/api/noticeboard/posts", post.id, "comments"],
    enabled: showComments,
  });

  const likeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/noticeboard/posts/${post.id}/like`, { browserId }),
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
    mutationFn: (content: string) =>
      apiRequest("POST", `/api/noticeboard/posts/${post.id}/comments`, { 
        content, 
        authorName: displayName || undefined 
      }),
    onSuccess: () => {
      setNewComment("");
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ["/api/noticeboard/posts"] });
    },
  });

  const handleSubmitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (newComment.trim()) {
      commentMutation.mutate(newComment.trim());
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
            
            <form onSubmit={handleSubmitComment} className="flex gap-2">
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
                disabled={!newComment.trim() || commentMutation.isPending}
                data-testid={`button-submit-comment-${post.id}`}
              >
                <Send className="h-4 w-4" />
              </Button>
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

function CreatePostForm({ onSuccess, displayName, onDisplayNameChange }: { 
  onSuccess: () => void; 
  displayName: string; 
  onDisplayNameChange: (name: string) => void;
}) {
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (data: { content: string; imageUrl?: string; authorName?: string }) =>
      apiRequest("POST", "/api/noticeboard/posts", data),
    onSuccess: () => {
      setContent("");
      setImageFile(null);
      setImagePreview(null);
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
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    let imageUrl: string | undefined;

    if (imageFile) {
      setIsUploading(true);
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
      setIsUploading(false);
    }

    createMutation.mutate({ 
      content: content.trim(), 
      imageUrl,
      authorName: displayName || undefined 
    });
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
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
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                id="image-upload"
                onChange={handleImageSelect}
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
            </div>
            
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
        </form>
      </CardContent>
    </Card>
  );
}

export default function NoticeboardPage() {
  const [displayName, setDisplayName] = useState(() => getStoredDisplayName());
  const [browserId] = useState(() => getBrowserId());
  
  const { data: posts = [], isLoading, refetch } = useQuery<Post[]>({
    queryKey: ["/api/noticeboard/posts", { browserId }],
    queryFn: async () => {
      const response = await fetch(`/api/noticeboard/posts?browserId=${browserId}`, {
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

  return (
    <div className="container max-w-2xl mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">
          Crew Noticeboard
        </h1>
        <p className="text-muted-foreground">
          Share updates, photos, and announcements with the team
        </p>
      </div>

      <Card className="mb-6 bg-primary/5 border-primary/20">
        <CardContent className="py-3">
          <div className="flex items-start gap-3">
            <Megaphone className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-primary mb-1">Welcome to the Crew Noticeboard!</h3>
              <p className="text-sm text-muted-foreground">
                This is your space to share updates, photos from set, announcements, and stay connected with the team.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <CreatePostForm 
          onSuccess={() => refetch()} 
          displayName={displayName}
          onDisplayNameChange={handleDisplayNameChange}
        />
        
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
            <PostCard key={post.id} post={post} onRefresh={() => refetch()} displayName={displayName} browserId={browserId} />
          ))
        )}
      </div>
    </div>
  );
}
